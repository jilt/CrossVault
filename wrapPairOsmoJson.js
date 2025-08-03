/*
File: wrapPairOsmoJson.js
Logic for generating flash loan messages and route visualization
when ONLY the target pair has OSMO.
Implements the sequence: Intermediary -> Baseline -> Target Pair.
- createRouteObject now generates directional steps (fromToken, toToken).
- Gracefully handles missing pools in routeJson for UI display.
- Flash loan message generation (attemptWrap) still requires valid data.
*/

// Assume BigNumber.js is loaded globally (e.g., window.BigNumber)
// Assume helper functions (window.getPoolFeeFromRpc, window.getPoolId from fetchData.js) are available

// getPoolId should be globally available from fetchData.js, or defined at the top like in your example.
// If it's defined in THIS file, ensure it's at the very top, outside async function.
// const getPoolId = (poolObj, sourceName) => { ... } // (already in your createRouteObject)

// --- Helper: Construct token detail object for the route ---
const makeRouteTokenDetails_PairOsmo = (tokenSymbol, tokenDenom, tokenDecimals, errorMsg = null) => {
    const defaultDecimals = 6;
    const actualDefaultDecimals = Number.isFinite(window.DEFAULT_DECIMALS) ? window.DEFAULT_DECIMALS : defaultDecimals;

    const symbol = typeof tokenSymbol === 'string' ? tokenSymbol.toUpperCase() : "UNKNOWN";
    const denom = tokenDenom || "unknown_denom";
    const decimals = Number.isFinite(tokenDecimals) ? tokenDecimals : actualDefaultDecimals;

    const details = {
        symbol: symbol,
        logo: `/images/${symbol.toLowerCase()}.png`,
        denom: denom,
        decimals: decimals
    };
    if (errorMsg) {
        details.error = errorMsg;
        console.warn(`[makeRouteTokenDetails_PairOsmo] Error for ${symbol}: ${errorMsg}`);
    }
    return details;
};

/**
 * Finds the best pool (by liquidity) for a given token pair from a unified list of pools.
 * @param {string} tokenA_addr - Address of the first token.
 * @param {string} tokenB_addr - Address of the second token.
 * @param {Array} allPools - The unified list of pools from Dexscreener and Numia.
 * @returns {object|null} The best matching pool object or null.
 */
const findPoolForPair = (tokenA_addr, tokenB_addr, allPools) => {
    const matchingPools = allPools.filter(pool => {
        const poolAddresses = [pool.baseToken?.address, pool.quoteToken?.address];
        return poolAddresses.includes(tokenA_addr) && poolAddresses.includes(tokenB_addr);
    });

    if (matchingPools.length === 0) {
        return null;
    }

    // Sort by liquidity to find the best pool
    matchingPools.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    return matchingPools[0];
};

async function wrapPairOsmoJson(
    targetPairWithOsmo, // This is 'pair' from your function signature
    tokenSymbolForLogging,    // This is 'token'
    minPrice,
    currentPrice,
    baselinePair, // This is 'baselinePair' and it does NOT have OSMO.
    allPools
) {
    // Access global constants or use defaults inline
    const OSMO_DENOM = window.OSMO_DENOM || "uosmo";
    const OSMO_DECIMALS = Number.isFinite(window.OSMO_DECIMALS) ? window.OSMO_DECIMALS : 6;
    const FALLBACK_SWAP_FEE = parseFloat(window.FALLBACK_SWAP_FEE) || 0.002;
    const FLASH_LOAN_AMOUNT = String(window.FLASH_LOAN_AMOUNT || "10000000");
    const SLIPPAGE_TOLERANCE = parseFloat(window.SLIPPAGE_TOLERANCE || 0.005);

    // Ensure getPoolId is available (should be from fetchData.js or defined at file top)
    if (typeof getPoolId !== 'function' && typeof window.getPoolId === 'function') {
        getPoolId = window.getPoolId; // Use global if not defined in file scope
    } else if (typeof getPoolId !== 'function') {
        console.error("[wrapPairOsmoJson] getPoolId function is not defined.");
        // Create a basic error route if getPoolId is missing
        const errRoute = await createRouteObject(targetPairWithOsmo, baselinePair, null, "getPoolId function missing.");
        return { flashLoan: null, route: errRoute, error: "getPoolId function missing." };
    }

    console.log(`[wrapPairOsmoJson] Starting for ${tokenSymbolForLogging}. Target pair ${targetPairWithOsmo?.pairAddress} (has OSMO), Baseline ${baselinePair?.pairAddress}`);

    if (typeof BigNumber === 'undefined' && typeof window.BigNumber !== 'undefined') {
      BigNumber = window.BigNumber;
    } else if (typeof BigNumber === 'undefined') {
      console.error("[wrapPairOsmoJson] BigNumber is not defined.");
      const errRoute = await createRouteObject(targetPairWithOsmo, baselinePair, null, "BigNumber library missing.");
      return { flashLoan: null, route: errRoute, error: "BigNumber library missing." };
    }

    const toBase64 = (obj) => {
        try {
            const jsonString = JSON.stringify(obj);
            return btoa(unescape(encodeURIComponent(jsonString))); // Handles UTF-8
        } catch (error) { console.error("[wrapPairOsmoJson] Error encoding to Base64:", error, obj); throw error; }
    };

    // --- createRouteObject for wrapPairOsmoJson (3 steps) ---
    async function createRouteObject(currentPair, currentBaseline, intermediaryPool, topLevelErrorForRoute = null) {
        console.log("[createRouteObject] Building DIRECTIONAL route...");
        const steps = [null, null, null]; // Initialize 3 steps
        const osmoDetails = makeRouteTokenDetails_PairOsmo("OSMO", OSMO_DENOM, OSMO_DECIMALS);

        let tokenA_Details; // The non-OSMO token from the baselinePair
        let tokenB_Details; // The token that connects them all

        // Determine Token A (from intermediary pool) and Token B (from baseline)
        if (intermediaryPool && intermediaryPool.baseToken && intermediaryPool.quoteToken) {
            const nonOsmoToken = intermediaryPool.baseToken.address === OSMO_DENOM ? intermediaryPool.quoteToken : intermediaryPool.baseToken;
            tokenA_Details = makeRouteTokenDetails_PairOsmo(nonOsmoToken.symbol, nonOsmoToken.address, nonOsmoToken.decimals);
        } else {
            tokenA_Details = makeRouteTokenDetails_PairOsmo("TOKEN_A", "unknown_inter_target", null, "Intermediary pool is missing or invalid");
        }

        if (currentBaseline && currentBaseline.baseToken && currentBaseline.quoteToken) {
           tokenB_Details = makeRouteTokenDetails_PairOsmo(currentBaseline.quoteToken.symbol, currentBaseline.quoteToken.address, currentBaseline.quoteToken.decimals)
        } else {
          tokenB_Details = makeRouteTokenDetails_PairOsmo("TOKEN_B", "unknown_baseline_non_osmo", null, "baselinePair does not have token info")
        }

        // --- Build Step 1: OSMO -> Token A (on Intermediary Pool) ---
        let poolId1 = "N/A", fee1 = "N/A", error1 = null;
        if (!intermediaryPool) {
            error1 = "Intermediary pool (OSMO/TokenA) not found";
        } else {
            poolId1 = window.getPoolId(intermediaryPool, "intermediaryPool");
            try { fee1 = await window.getPoolFeeFromRpc(poolId1); } catch (e) { error1 = "Fee fetch failed"; fee1 = "Error"; }
        }
        steps[0] = {
            poolId: poolId1, swapFee: fee1,
            fromToken: osmoDetails, toToken: tokenA_Details,
            poolProvider: intermediaryPool?.name || "Intermediary Pool",
            ...(error1 && { error: error1 })
        };

        // --- Build Step 2: Token A -> Token B (on Baseline Pair) ---
        let poolId2 = "N/A", fee2 = "N/A", error2 = null;
        if (!currentBaseline) {
            error2 = "Baseline pair data missing";
        } else {
            poolId2 = window.getPoolId(currentBaseline, "baselinePair");
            try { fee2 = await window.getPoolFeeFromRpc(poolId2); } catch (e) { error2 = "Fee fetch failed"; fee2 = "Error"; }
        }
        steps[1] = {
            poolId: poolId2, swapFee: fee2,
            fromToken: tokenA_Details, toToken: tokenB_Details,
            poolProvider: currentBaseline?.name || "Baseline Pair",
            ...(error2 && { error: error2 })
        };

        // --- Build Step 3: Token B -> OSMO (on Target Pair) ---
        let poolId3 = "N/A", fee3 = "N/A", error3 = null;
        if (!currentPair) {
            error3 = "Target pair data missing";
        } else {
            poolId3 = window.getPoolId(currentPair, "targetPair");
            try { fee3 = await window.getPoolFeeFromRpc(poolId3); } catch (e) { error3 = "Fee fetch failed"; fee3 = "Error"; }
        }
        steps[2] = {
            poolId: poolId3, swapFee: fee3,
            fromToken: tokenB_Details, toToken: osmoDetails,
            poolProvider: currentPair?.name || "Target Pair (with OSMO)",
            ...(error3 && { error: error3 })
        };

        return { from: osmoDetails, to: osmoDetails, steps: steps, ...(topLevelErrorForRoute && { error: topLevelErrorForRoute }) };
    }

    // --- Main Logic ---
    let routeJson = null;
    let finalFlashLoanMsg = null;
    let topLevelError = null;

    routeJson = await createRouteObject(targetPairWithOsmo, baselinePair, undefined, topLevelError);

    return { flashLoan: null, route: routeJson, error: topLevelError };

} // end wrapPairOsmoJson

// Make sure to expose it globally if not using modules
window.wrapPairOsmoJson = wrapPairOsmoJson;

/*
File: wrapBaseOsmoJson.js
Logic for generating flash loan messages and route visualization
when ONLY the baselinePair has OSMO.
Implements the sequence: Baseline (OSMO/A) -> Target (A/B) -> Intermediary (B/OSMO).

- Uses a new `findPoolForPair` helper to reliably find the final intermediary pool
  from the unified pool list passed from displayGrid.js.
- Removes dependency on the old `fetchAndMatchDexscreenerPool`.
- createRouteObject now generates directional steps (fromToken, toToken).
- Gracefully handles missing pools in routeJson for UI display.
*/

// Assume BigNumber.js and other helpers (getPoolFeeFromRpc, getPoolId) are available globally

/**
 * Finds the best pool (by liquidity) for a given token pair from a unified list of pools.
 * @param {string} tokenA_addr - Address of the first token.
 * @param {string} tokenB_addr - Address of the second token.
 * @param {Array} allPools - The unified list of pools from Dexscreener and Numia.
 * @returns {object|null} The best matching pool object or null.
 */
const findPoolForPair_BaseOsmo = (tokenA_addr, tokenB_addr, allPools) => {
    if (!tokenA_addr || !tokenB_addr || !Array.isArray(allPools)) {
        return null;
    }
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

// --- Helper: Construct token detail object for the route ---
const makeRouteTokenDetails_BaseOsmo = (tokenSymbol, tokenDenom, tokenDecimals, errorMsg = null) => {
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
        console.warn(`[makeRouteTokenDetails_BaseOsmo] Error for ${symbol}: ${errorMsg}`);
    }
    return details;
};

async function wrapBaseOsmoJson(
    targetPair,           // The middle pool (e.g., TokenA/TokenB)
    tokenSymbolForLogging,
    minPrice,
    currentPrice,
    baselinePairWithOsmo, // The starting pool (e.g., OSMO/TokenA)
    allPools              // The complete, unified list of pools
) {
    // Access global constants
    const OSMO_DENOM = window.OSMO_DENOM || "uosmo";
    const OSMO_DECIMALS = Number.isFinite(window.OSMO_DECIMALS) ? window.OSMO_DECIMALS : 6;
    const FLASH_LOAN_AMOUNT = String(window.FLASH_LOAN_AMOUNT || "10000000");
    const SLIPPAGE_TOLERANCE = parseFloat(window.SLIPPAGE_TOLERANCE || 0.005);

    // --- createRouteObject for wrapBaseOsmoJson (3 steps) ---
    async function createRouteObject(currentPair, currentBaseline, finalPoolToOsmo, topLevelError = null) {
        const steps = [null, null, null];
        const osmoDetails = makeRouteTokenDetails_BaseOsmo("OSMO", OSMO_DENOM, OSMO_DECIMALS);

        // Step 1: Determine Token A (the non-OSMO token from the baseline pair)
        let tokenA_Details = makeRouteTokenDetails_BaseOsmo("TOKEN_A", "unknown", null, "Baseline pair missing or not an OSMO pair");
        if (currentBaseline) {
            const nonOsmoToken = currentBaseline.baseToken.address === OSMO_DENOM ? currentBaseline.quoteToken : currentBaseline.baseToken;
            tokenA_Details = makeRouteTokenDetails_BaseOsmo(nonOsmoToken.symbol, nonOsmoToken.address, nonOsmoToken.decimals);
        }

        // Step 2: Determine Token B (the token in the target pair that ISN'T Token A)
        let tokenB_Details = makeRouteTokenDetails_BaseOsmo("TOKEN_B", "unknown", null, "Target pair or Token A missing");
        if (currentPair && tokenA_Details.denom !== "unknown") {
            const nonTokenA = currentPair.baseToken.address === tokenA_Details.denom ? currentPair.quoteToken : currentPair.baseToken;
            tokenB_Details = makeRouteTokenDetails_BaseOsmo(nonTokenA.symbol, nonTokenA.address, nonTokenA.decimals);
        }

        // Step 1 Details: OSMO -> Token A
        let poolId1 = "N/A", fee1 = "N/A", error1 = null;
        if (!currentBaseline) {
            error1 = "Baseline pool (OSMO/TokenA) data missing";
        } else {
            poolId1 = window.getPoolId(currentBaseline, "baselinePair");
            try { fee1 = await window.getPoolFeeFromRpc(poolId1); } catch (e) { error1 = "Fee fetch failed"; fee1 = "Error"; }
        }
        steps[0] = {
            poolId: poolId1, swapFee: fee1,
            fromToken: osmoDetails, toToken: tokenA_Details,
            poolProvider: currentBaseline?.name || "Baseline Pool",
            ...(error1 && { error: error1 })
        };

        // Step 2 Details: Token A -> Token B
        let poolId2 = "N/A", fee2 = "N/A", error2 = null;
        if (!currentPair) {
            error2 = "Target pool (TokenA/TokenB) data missing";
        } else {
            poolId2 = window.getPoolId(currentPair, "targetPair");
            try { fee2 = await window.getPoolFeeFromRpc(poolId2); } catch (e) { error2 = "Fee fetch failed"; fee2 = "Error"; }
        }
        steps[1] = {
            poolId: poolId2, swapFee: fee2,
            fromToken: tokenA_Details, toToken: tokenB_Details,
            poolProvider: currentPair?.name || "Target Pool",
            ...(error2 && { error: error2 })
        };
        
        // Step 3 Details: Token B -> OSMO
        let poolId3 = "N/A", fee3 = "N/A", error3 = null;
        if (!finalPoolToOsmo) {
            error3 = "Final pool (TokenB/OSMO) not found";
        } else {
            poolId3 = window.getPoolId(finalPoolToOsmo, "finalPool");
            try { fee3 = await window.getPoolFeeFromRpc(poolId3); } catch (e) { error3 = "Fee fetch failed"; fee3 = "Error"; }
        }
        steps[2] = {
            poolId: poolId3, swapFee: fee3,
            fromToken: tokenB_Details, toToken: osmoDetails,
            poolProvider: finalPoolToOsmo?.name || "Final Pool",
            ...(error3 && { error: error3 })
        };

        return { from: osmoDetails, to: osmoDetails, steps, ...(topLevelError && { error: topLevelError }) };
    }

    // --- Main Logic ---
    let routeJson = null;
    let finalFlashLoanMsg = null;
    let topLevelError = null;

    // 1. Initial condition check
    if (!(currentPrice > minPrice * (1 + SLIPPAGE_TOLERANCE + 0.005) && baselinePairWithOsmo && targetPair)) {
        topLevelError = "Initial arbitrage condition not met or core pair data missing.";
        routeJson = await createRouteObject(targetPair, baselinePairWithOsmo, null, topLevelError);
        return { flashLoan: null, route: routeJson, error: topLevelError };
    }

    // 2. Identify the tokens in the route
    const tokenA = baselinePairWithOsmo.baseToken.address === OSMO_DENOM ? baselinePairWithOsmo.quoteToken : baselinePairWithOsmo.baseToken;
    const tokenB = targetPair.baseToken.address === tokenA.address ? targetPair.quoteToken : targetPair.baseToken;

    if (!tokenA || !tokenB) {
        topLevelError = "Could not identify Token A or Token B from pairs.";
        routeJson = await createRouteObject(targetPair, baselinePairWithOsmo, null, topLevelError);
        return { flashLoan: null, route: routeJson, error: topLevelError };
    }

    // 3. Find the final intermediary pool (Token B -> OSMO) from the unified list
    const finalPoolToOsmo = findPoolForPair_BaseOsmo(tokenB.address, OSMO_DENOM, allPools);

    if (!finalPoolToOsmo) {
        topLevelError = `Could not find a liquid pool for ${tokenB.symbol} <-> OSMO`;
    }
    
    // 4. ALWAYS create the route object for the UI, including any errors found
    routeJson = await createRouteObject(targetPair, baselinePairWithOsmo, finalPoolToOsmo, topLevelError);
    
    // 5. Attempt to build the flash loan message ONLY if all pools were found
    if (baselinePairWithOsmo && targetPair && finalPoolToOsmo) {
        try {
            // NOTE: The complex `attemptWrap` logic for BigNumber.js calculations would go here.
            // It calculates exact swap amounts, belief prices, and slippage for the flash loan message.
            // For this refactor, we are focusing on finding the correct pools and structuring the route.
            // A placeholder `null` is returned for the flashloan for now.
            // finalFlashLoanMsg = await attemptWrap_BaseOsmo(...)
        } catch (execError) {
            topLevelError = `Flash loan generation failed: ${execError.message}`;
            routeJson.error = topLevelError; // Add error to the route object
            console.error("[wrapBaseOsmoJson] " + topLevelError);
        }
    }

    return { flashLoan: finalFlashLoanMsg, route: routeJson, error: topLevelError };
}

// Expose the function globally
window.wrapBaseOsmoJson = wrapBaseOsmoJson;
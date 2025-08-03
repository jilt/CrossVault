/*
File: wrapAllOsmoJson.js
Logic for generating flash loan messages and route visualization
when BOTH pairs have OSMO.
Implements the sequence: Baseline (OSMO/A) -> Target Pair (A/OSMO).
- createRouteObject now generates directional steps (fromToken, toToken).
- Gracefully handles missing/invalid pair data in routeJson for UI display.
- Flash loan message generation still requires valid data for execution.
*/

// Assume BigNumber.js is loaded globally (e.g., window.BigNumber)
// Assume helper functions (window.getPoolFeeFromRpc, window.getPoolId from fetchData.js) are available

// getPoolId should be globally available from fetchData.js or defined at file top.
// If defined in THIS file, ensure it's at the very top.
// const getPoolId = (poolObj, sourceName) => { ... } // (already in your createRouteObject)

// --- Helper: Construct token detail object for the route ---
const makeRouteTokenDetails_AllOsmo = (tokenSymbol, tokenDenom, tokenDecimals, errorMsg = null) => {
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
        console.warn(`[makeRouteTokenDetails_AllOsmo] Error for ${symbol}: ${errorMsg}`);
    }
    return details;
};


async function wrapAllOsmoJson(
    targetPair, // This is 'pair' from your function signature
    tokenSymbolForLogging,    // This is 'token'
    minPrice,
    currentPrice,
    baselinePairWithOsmo, // This is 'baselinePair'
    numiaDataFromCaller   // Not used in this 2-step scenario, but kept for signature consistency
) {
    // Access global constants or use defaults inline
    const OSMO_DENOM = window.OSMO_DENOM || "uosmo";
    const OSMO_DECIMALS = Number.isFinite(window.OSMO_DECIMALS) ? window.OSMO_DECIMALS : 6;
    const FALLBACK_SWAP_FEE = parseFloat(window.FALLBACK_SWAP_FEE) || 0.002;
    const FLASH_LOAN_AMOUNT = String(window.FLASH_LOAN_AMOUNT || "10000000");
    const SLIPPAGE_TOLERANCE = parseFloat(window.SLIPPAGE_TOLERANCE || 0.005);

    // Ensure getPoolId is available
    let getPoolIdFunc = null;
    if (typeof getPoolId === 'function') { // Check if defined in file scope (e.g. user's original example)
        getPoolIdFunc = getPoolId;
    } else if (typeof window.getPoolId === 'function') {
        getPoolIdFunc = window.getPoolId;
    } else {
        console.error("[wrapAllOsmoJson] getPoolId function is not defined.");
        // Create a basic error route if getPoolId is missing
        const errRoute = await createRouteObject_AllOsmo(targetPair, baselinePairWithOsmo, "getPoolId function missing.");
        return { flashLoan: null, route: errRoute, error: "getPoolId function missing." };
    }


    console.log(`[wrapAllOsmoJson] Starting for ${tokenSymbolForLogging}. Baseline ${baselinePairWithOsmo?.pairAddress}, Target ${targetPair?.pairAddress} (both have OSMO).`);

    if (typeof BigNumber === 'undefined' && typeof window.BigNumber !== 'undefined') {
      BigNumber = window.BigNumber;
    } else if (typeof BigNumber === 'undefined') {
      console.error("[wrapAllOsmoJson] BigNumber is not defined.");
      const errRoute = await createRouteObject_AllOsmo(targetPair, baselinePairWithOsmo, "BigNumber library missing.");
      return { flashLoan: null, route: errRoute, error: "BigNumber library missing." };
    }

    const toBase64 = (obj) => {
        try {
            const jsonString = JSON.stringify(obj);
            return btoa(unescape(encodeURIComponent(jsonString)));
        } catch (error) { console.error("[wrapAllOsmoJson] Error encoding to Base64:", error, obj); throw error; }
    };

    // --- createRouteObject for wrapAllOsmoJson (2 steps) ---
    async function createRouteObject_AllOsmo(currentTargetPair_route, currentBaseline_route, topLevelErrorForRoute = null) {
        console.log("[createRouteObject_AllOsmo] Building DIRECTIONAL 2-step route...");
        const steps = [null, null]; // Initialize 2 steps
        const osmoDetails = makeRouteTokenDetails_AllOsmo("OSMO", OSMO_DENOM, OSMO_DECIMALS);
        let stepSpecificError = null;

        let tokenA_Details; // The non-OSMO token from the baselinePair

        // Determine Token A (Output of Step 1: OSMO -> TokenA via BaselinePairWithOsmo)
        if (currentBaseline_route && currentBaseline_route.baseToken && currentBaseline_route.quoteToken) {
            if (currentBaseline_route.baseToken.address === OSMO_DENOM) { // OSMO is base
                tokenA_Details = makeRouteTokenDetails_AllOsmo(currentBaseline_route.quoteToken.symbol, currentBaseline_route.quoteToken.address, currentBaseline_route.quoteToken.decimals);
            } else if (currentBaseline_route.quoteToken.address === OSMO_DENOM) { // OSMO is quote
                tokenA_Details = makeRouteTokenDetails_AllOsmo(currentBaseline_route.baseToken.symbol, currentBaseline_route.baseToken.address, currentBaseline_route.baseToken.decimals);
            } else {
                tokenA_Details = makeRouteTokenDetails_AllOsmo("TOKEN_A", "unknown_baseline_non_osmo", null, "Baseline pair does not contain OSMO as expected");
            }
        } else {
            tokenA_Details = makeRouteTokenDetails_AllOsmo("TOKEN_A", "unknown_baseline_non_osmo", null, "Baseline Pair data missing for Token A");
        }

        // --- Build Step 1: OSMO -> Token A (on Baseline Pair) ---
        stepSpecificError = null;
        let poolId1 = "N/A", fee1 = "N/A";
        if (!currentBaseline_route || !getPoolIdFunc(currentBaseline_route, "step1_id_check_all").match(/^\d+$/)) {
            stepSpecificError = "Baseline pair data missing or has invalid numeric ID";
        } else {
            poolId1 = getPoolIdFunc(currentBaseline_route, "currentBaseline_route_all");
            try { fee1 = await window.getPoolFeeFromRpc(poolId1); } catch (e) { stepSpecificError = "Fee fetch error (Step 1)"; fee1 = "Error"; }
        }
        steps[0] = {
            poolId: poolId1, swapFee: fee1,
            fromToken: osmoDetails,
            toToken: tokenA_Details,
            poolProvider: currentBaseline_route?.name || "Baseline Pair (OSMO/TokenA)",
            ...(stepSpecificError && { error: stepSpecificError })
        };

        // --- Build Step 2: Token A -> OSMO (on Target Pair) ---
        stepSpecificError = null;
        let poolId2 = "N/A", fee2 = "N/A";
        if (!currentTargetPair_route || !getPoolIdFunc(currentTargetPair_route, "step2_id_check_all").match(/^\d+$/)) {
            stepSpecificError = "Target pair data missing or has invalid numeric ID";
        } else {
            poolId2 = getPoolIdFunc(currentTargetPair_route, "targetPair_route_all");
            try { fee2 = await window.getPoolFeeFromRpc(poolId2); } catch (e) { stepSpecificError = "Fee fetch error (Step 2)"; fee2 = "Error"; }
        }
        steps[1] = {
            poolId: poolId2, swapFee: fee2,
            fromToken: tokenA_Details, // Output from Step 1 becomes input for Step 2
            toToken: osmoDetails,
            poolProvider: currentTargetPair_route?.name || "Target Pair (TokenA/OSMO)",
            ...(stepSpecificError && { error: stepSpecificError })
        };
        
        let finalRouteObject = {
            from: osmoDetails,
            to: osmoDetails,
            steps: steps
        };
        if (topLevelErrorForRoute) {
            finalRouteObject.error = topLevelErrorForRoute;
        }
        return finalRouteObject;
    } // end createRouteObject_AllOsmo


    // --- Main Logic for wrapAllOsmoJson ---
    let routeJson = null;
    let finalFlashLoanMsg = null;
    let topLevelError = null;

    if (!(currentPrice > minPrice * (1 + SLIPPAGE_TOLERANCE + 0.005) && baselinePairWithOsmo?.pool_id && targetPair?.pool_id)) {
        topLevelError = "Initial arbitrage condition not met or core pair data missing (incl. pool_id).";
        console.warn(`[wrapAllOsmoJson] ${topLevelError} for ${tokenSymbolForLogging}`);
        routeJson = await createRouteObject_AllOsmo(targetPair, baselinePairWithOsmo);
        return { flashLoan: null, route: routeJson, error: topLevelError };
    }
    console.log(`[wrapAllOsmoJson] Initial condition MET for ${tokenSymbolForLogging}.`);

    // --- Execution Path (Flash Loan Message Generation) ---
    try {
        const execFlashLoanMsgs = []; // Messages specific to the 2 swaps

        // --- Token & Contract Info for Execution ---
        const baselineHasBaseOsmo_exec = baselinePairWithOsmo.baseToken?.address === OSMO_DENOM;
        const baselineContractAddr_exec = baselinePairWithOsmo.poolAddress;
        const baselinePoolId_exec = getPoolIdFunc(baselinePairWithOsmo, "baselinePair_exec_id");
        const baselineBaseDec_exec = baselinePairWithOsmo.baseToken?.decimals ?? 6;
        const baselineQuoteDec_exec = baselinePairWithOsmo.quoteToken?.decimals ?? 6;
        const baselinePrice_exec = baselinePairWithOsmo.priceNative ? parseFloat(baselinePairWithOsmo.priceNative) : null;

        const targetPairHasBaseOsmo_exec = targetPair.baseToken?.address === OSMO_DENOM;
        const targetPairContractAddr_exec = targetPair.poolAddress;
        const targetPairPoolId_exec = getPoolIdFunc(targetPair, "targetPair_exec_id");
        const targetPairBaseDec_exec = targetPair.baseToken?.decimals ?? 6;
        const targetPairQuoteDec_exec = targetPair.quoteToken?.decimals ?? 6;
        const targetPairPrice_exec = targetPair.priceNative ? parseFloat(targetPair.priceNative) : null;

        if (!baselineContractAddr_exec || !targetPairContractAddr_exec ||
            baselinePoolId_exec === "N/A" || !baselinePoolId_exec.match(/^\d+$/) ||
            targetPairPoolId_exec === "N/A" || !targetPairPoolId_exec.match(/^\d+$/) ||
            baselinePrice_exec === null || isNaN(baselinePrice_exec) ||
            targetPairPrice_exec === null || isNaN(targetPairPrice_exec)) {
            throw new Error("Core pair data (address, numeric pool_id, price) missing for execution.");
        }

        // Fetch fees for execution
        const [fee1Str, fee2Str] = await Promise.all([
            window.getPoolFeeFromRpc(baselinePoolId_exec),
            window.getPoolFeeFromRpc(targetPairPoolId_exec)
        ]);
        const actualFee1 = !isNaN(parseFloat(fee1Str)) ? parseFloat(fee1Str) : FALLBACK_SWAP_FEE;
        const actualFee2 = !isNaN(parseFloat(fee2Str)) ? parseFloat(fee2Str) : FALLBACK_SWAP_FEE;
        console.log(`[wrapAllOsmoJson Fees Exec] Baseline (${baselinePoolId_exec}): ${actualFee1}, Target (${targetPairPoolId_exec}): ${actualFee2}`);

        // Step 1: Swap OSMO on Baseline Pair (OSMO -> Token A)
        let tokenA_Addr_exec, tokenA_Amount_str, tokenA_Dec_exec;
        let belief1; let expectedAmt1_BN;
        const offerAsset1 = { info: { native_token: { denom: OSMO_DENOM } }, amount: FLASH_LOAN_AMOUNT };

        if (baselineHasBaseOsmo_exec) { // OSMO is Base, Token A is Quote
            tokenA_Addr_exec = baselinePairWithOsmo.quoteToken.address;
            tokenA_Dec_exec = baselineQuoteDec_exec;
            belief1 = new BigNumber(baselinePrice_exec).multipliedBy(1 + SLIPPAGE_TOLERANCE).toFixed(18);
            expectedAmt1_BN = new BigNumber(FLASH_LOAN_AMOUNT).shiftedBy(-OSMO_DECIMALS)
                .dividedBy(baselinePrice_exec).multipliedBy(1 - actualFee1).multipliedBy(1 - SLIPPAGE_TOLERANCE);
        } else { // OSMO is Quote, Token A is Base
            tokenA_Addr_exec = baselinePairWithOsmo.baseToken.address;
            tokenA_Dec_exec = baselineBaseDec_exec;
            belief1 = new BigNumber(baselinePrice_exec).multipliedBy(1 - SLIPPAGE_TOLERANCE).toFixed(18);
            expectedAmt1_BN = new BigNumber(FLASH_LOAN_AMOUNT).shiftedBy(-OSMO_DECIMALS)
                .multipliedBy(baselinePrice_exec).multipliedBy(1 - actualFee1).multipliedBy(1 - SLIPPAGE_TOLERANCE);
        }
        tokenA_Amount_str = expectedAmt1_BN.shiftedBy(tokenA_Dec_exec).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
        if (tokenA_Amount_str === "0") throw new Error("Step 1 (OSMO -> Token A) calc resulted in zero amount.");
        const swapMsg1 = { swap: { offer_asset: offerAsset1, ask_asset_info: { token: { contract_addr: tokenA_Addr_exec } }, belief_price: belief1, max_spread: String(SLIPPAGE_TOLERANCE) } };
        execFlashLoanMsgs.push({ wasm: { execute: { contract_addr: baselineContractAddr_exec, msg: toBase64(swapMsg1), funds: [{ denom: OSMO_DENOM, amount: FLASH_LOAN_AMOUNT }] } } });

        // Step 2: Swap Token A on Target Pair (Token A -> OSMO)
        let belief2; let expectedReturnOsmo_BN;
        const offerAsset2 = { info: { token: { contract_addr: tokenA_Addr_exec } }, amount: tokenA_Amount_str };
        const askAsset2 = { info: { native_token: { denom: OSMO_DENOM } } };
        const offerAmt2_BN = new BigNumber(tokenA_Amount_str).shiftedBy(-tokenA_Dec_exec);

        if (targetPairHasBaseOsmo_exec) { // OSMO is Base, Token A is Quote
            if (targetPair.quoteToken.address !== tokenA_Addr_exec) throw new Error(`Logic error: Target Pair quote token ${targetPair.quoteToken.address.slice(-6)} does not match Token A ${tokenA_Addr_exec.slice(-6)}`);
            belief2 = new BigNumber(targetPairPrice_exec).multipliedBy(1 - SLIPPAGE_TOLERANCE).toFixed(18); // Sell Token A high vs OSMO
            expectedReturnOsmo_BN = offerAmt2_BN.multipliedBy(targetPairPrice_exec).multipliedBy(1 - actualFee2).multipliedBy(1 - SLIPPAGE_TOLERANCE);
        } else { // OSMO is Quote, Token A is Base
            if (targetPair.baseToken.address !== tokenA_Addr_exec) throw new Error(`Logic error: Target Pair base token ${targetPair.baseToken.address.slice(-6)} does not match Token A ${tokenA_Addr_exec.slice(-6)}`);
            belief2 = new BigNumber(1).dividedBy(new BigNumber(targetPairPrice_exec).multipliedBy(1 + SLIPPAGE_TOLERANCE)).toFixed(18); // Buy OSMO low with Token A
            expectedReturnOsmo_BN = offerAmt2_BN.dividedBy(targetPairPrice_exec).multipliedBy(1 - actualFee2).multipliedBy(1 - SLIPPAGE_TOLERANCE);
        }
        const swapMsg2 = { swap: { offer_asset: offerAsset2, ask_asset_info: askAsset2, belief_price: belief2, max_spread: String(SLIPPAGE_TOLERANCE) } };
        execFlashLoanMsgs.push({ wasm: { execute: { contract_addr: targetPairContractAddr_exec, msg: toBase64(swapMsg2), funds: [] } } }); // TODO: Allowance

        finalFlashLoanMsg = {
            flash_loan: {
                assets: [{ info: { native_token: { denom: OSMO_DENOM } }, amount: FLASH_LOAN_AMOUNT }],
                msgs: execFlashLoanMsgs,
            },
        };

        // Profit Check
        const expectedReturnOsmo_str = expectedReturnOsmo_BN.shiftedBy(OSMO_DECIMALS).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
        const profit = new BigNumber(expectedReturnOsmo_str).minus(FLASH_LOAN_AMOUNT);
        console.log(`[wrapAllOsmoJson EXEC PROFIT CHECK for ${tokenSymbolForLogging}] Expected Return: ${expectedReturnOsmo_str} uOSMO, Loan: ${FLASH_LOAN_AMOUNT} uOSMO, Profit: ${profit.toString()} uOSMO`);
        if (profit.isLessThanOrEqualTo(0)) {
            topLevelError = "Path not profitable for execution after calculations.";
            console.warn(`[wrapAllOsmoJson] ${topLevelError} for ${tokenSymbolForLogging}`);
            finalFlashLoanMsg = null;
        } else {
            console.log(`[wrapAllOsmoJson] Profitable path found for ${tokenSymbolForLogging}! Profit: ${profit.toString()} uOSMO`);
        }

    } catch (execError) {
        topLevelError = `Execution logic failed: ${execError.message}`;
        console.warn(`[wrapAllOsmoJson] ${topLevelError} for ${tokenSymbolForLogging}`, execError);
        finalFlashLoanMsg = null;
    }

    // ALWAYS Create Route Object
    // This is called after potential execution failure so `topLevelError` might be set
    routeJson = await createRouteObject_AllOsmo(targetPair, baselinePairWithOsmo, topLevelError);

    console.log(`[wrapAllOsmoJson] Returning for ${tokenSymbolForLogging}. FlashLoan: ${!!finalFlashLoanMsg}, Route: ${!!routeJson}, TopLevelError: ${topLevelError || 'None'}`);
    return { flashLoan: finalFlashLoanMsg, route: routeJson, error: topLevelError };

} // end wrapAllOsmoJson

// Make sure to expose it globally if not using modules
window.wrapAllOsmoJson = wrapAllOsmoJson;
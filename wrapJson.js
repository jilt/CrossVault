/*
File: wrapNoOsmoJson.js
Logic for generating flash loan messages and route visualization
when NEITHER pair has OSMO.
Implements the sequence: EnterPool -> Baseline -> Target -> ExitPool.
Fetches accurate swap fees via LCD endpoint.
*/

// Assumes BigNumber.js and helper functions (window.getPoolFeeFromRpc, window.fetchAndMatchDexscreenerPool) are available
// import BigNumber from 'bignumber.js';



// --- Helper: Construct token detail object for the route ---
const makeRouteTokenDetails = (tokenSymbol, tokenDenom, tokenDecimals, errorMsg = null) => {
    const defaultDecimals = 6;
    const symbol = typeof tokenSymbol === 'string' ? tokenSymbol.toUpperCase() : "UNKNOWN";
    const denom = tokenDenom || "unknown_denom";
    const decimals = Number.isFinite(tokenDecimals) ? tokenDecimals : defaultDecimals;

    const details = {
        symbol: symbol,
        logo: `/images/${symbol.toLowerCase()}.png`, // Assuming logo path convention
        denom: denom,
        decimals: decimals
    };
    if (errorMsg) {
        details.error = errorMsg;
        console.warn(`[makeRouteTokenDetails] Error for ${symbol}: ${errorMsg}`);
    }
    return details;
};

// --- createRouteObject (Generates directional steps for UI) ---
async function createRouteObject(
    currentPair,         // The target pair (e.g., TokenB_Shared/TokenC)
    currentBaseline,     // The baseline pair (e.g., TokenA/TokenB_Shared)
    intermediaryPoolEnter, // Pool: OSMO / TokenA (can be null)
    intermediaryPoolExit,  // Pool: TokenC / OSMO (can be null)
    sharedTokenAddressFromMainLogic // The address of Token B (Shared)
) {
    console.log("[createRouteObject] Building DIRECTIONAL route...");

    const steps = [null, null, null, null]; // Initialize 4 steps
    const osmoDetails = makeRouteTokenDetails("OSMO", OSMO_DENOM, OSMO_DECIMALS);
    let stepSpecificError = null;

    // Define intermediate tokens based on the intended flow
    let tokenA_Details, tokenB_Shared_Details, tokenC_Details;

    // Determine Token A (Output of Step 1: OSMO -> TokenA via IntermediaryEnter)
    if (intermediaryPoolEnter && intermediaryPoolEnter.baseToken && intermediaryPoolEnter.quoteToken) {
        if (intermediaryPoolEnter.baseToken.address === OSMO_DENOM) {
            tokenA_Details = makeRouteTokenDetails(intermediaryPoolEnter.quoteToken.symbol, intermediaryPoolEnter.quoteToken.address, intermediaryPoolEnter.quoteToken.decimals);
        } else if (intermediaryPoolEnter.quoteToken.address === OSMO_DENOM) {
            tokenA_Details = makeRouteTokenDetails(intermediaryPoolEnter.baseToken.symbol, intermediaryPoolEnter.baseToken.address, intermediaryPoolEnter.baseToken.decimals);
        } else {
            tokenA_Details = makeRouteTokenDetails("TOKEN_A", "unknown_enter_target", null, "Enter pool is not an OSMO pair");
        }
    } else {
        tokenA_Details = makeRouteTokenDetails("TOKEN_A", "unknown_enter_target", null, "Intermediary Enter Pool data missing");
    }

    // Determine Token B (Shared Token - Output of Step 2: TokenA -> TokenB_Shared via BaselinePair)
    if (sharedTokenAddressFromMainLogic && currentBaseline && currentBaseline.baseToken && currentBaseline.quoteToken) {
        if (currentBaseline.baseToken.address === sharedTokenAddressFromMainLogic) {
            tokenB_Shared_Details = makeRouteTokenDetails(currentBaseline.baseToken.symbol, currentBaseline.baseToken.address, currentBaseline.baseToken.decimals);
        } else if (currentBaseline.quoteToken.address === sharedTokenAddressFromMainLogic) {
            tokenB_Shared_Details = makeRouteTokenDetails(currentBaseline.quoteToken.symbol, currentBaseline.quoteToken.address, currentBaseline.quoteToken.decimals);
        } else {
            tokenB_Shared_Details = makeRouteTokenDetails("SHARED_B", sharedTokenAddressFromMainLogic, null, `Shared token not found in Baseline Pair`);
        }
    } else {
        tokenB_Shared_Details = makeRouteTokenDetails("SHARED_B", sharedTokenAddressFromMainLogic || "unknown_shared", null, "Baseline Pair or Shared Token address missing for Token B");
    }

    // Determine Token C (Output of Step 3: TokenB_Shared -> TokenC via TargetPair)
    if (sharedTokenAddressFromMainLogic && currentPair && currentPair.baseToken && currentPair.quoteToken) {
        if (currentPair.baseToken.address === sharedTokenAddressFromMainLogic) {
            tokenC_Details = makeRouteTokenDetails(currentPair.quoteToken.symbol, currentPair.quoteToken.address, currentPair.quoteToken.decimals);
        } else if (currentPair.quoteToken.address === sharedTokenAddressFromMainLogic) {
            tokenC_Details = makeRouteTokenDetails(currentPair.baseToken.symbol, currentPair.baseToken.address, currentPair.baseToken.decimals);
        } else {
            tokenC_Details = makeRouteTokenDetails("TOKEN_C", "unknown_target_output", null, `Shared token not found in Target Pair`);
        }
    } else {
        tokenC_Details = makeRouteTokenDetails("TOKEN_C", "unknown_target_output", null, "Target Pair or Shared Token address missing for Token C");
    }

    // --- Build Step 1: OSMO -> Token A (on Intermediary Enter Pool) ---
    stepSpecificError = null;
    let poolId1 = "N/A", fee1 = "N/A";
    if (!intermediaryPoolEnter || !window.getPoolId(intermediaryPoolEnter, "step1_id_check").match(/^\d+$/)) {
        stepSpecificError = "Enter pool data missing or has invalid numeric ID";
        if (!tokenA_Details.error) tokenA_Details.error = "Output token details may be incorrect due to missing enter pool";
    } else {
        poolId1 = window.getPoolId(intermediaryPoolEnter, "intermediaryPoolEnter_route");
        try { fee1 = await window.getPoolFeeFromRpc(poolId1); } catch (e) { stepSpecificError = "Fee fetch error (Step 1)"; fee1 = "Error"; }
    }
    steps[0] = {
        poolId: poolId1, swapFee: fee1,
        fromToken: osmoDetails,
        toToken: tokenA_Details,
        poolProvider: intermediaryPoolEnter?.name || "Intermediary Enter Pool",
        ...(stepSpecificError && { error: stepSpecificError })
    };

    // --- Build Step 2: Token A -> Token B (Shared) (on Baseline Pair) ---
    stepSpecificError = null;
    let poolId2 = "N/A", fee2 = "N/A";
    if (!currentBaseline || !window.getPoolId(currentBaseline, "step2_id_check").match(/^\d+$/)) {
        stepSpecificError = "Baseline pair data missing or has invalid numeric ID";
        if (!tokenB_Shared_Details.error) tokenB_Shared_Details.error = "Output token details may be incorrect due to missing baseline data";
    } else {
        poolId2 = window.getPoolId(currentBaseline, "currentBaseline_route");
        try { fee2 = await window.getPoolFeeFromRpc(poolId2); } catch (e) { stepSpecificError = "Fee fetch error (Step 2)"; fee2 = "Error"; }
    }
    steps[1] = {
        poolId: poolId2, swapFee: fee2,
        fromToken: tokenA_Details,
        toToken: tokenB_Shared_Details,
        poolProvider: currentBaseline?.name || "Baseline Pair",
        ...(stepSpecificError && { error: stepSpecificError })
    };

    // --- Build Step 3: Token B (Shared) -> Token C (on Target Pair) ---
    stepSpecificError = null;
    let poolId3 = "N/A", fee3 = "N/A";
    if (!currentPair || !window.getPoolId(currentPair, "step3_id_check").match(/^\d+$/)) {
        stepSpecificError = "Target pair data missing or has invalid numeric ID";
        if (!tokenC_Details.error) tokenC_Details.error = "Output token details may be incorrect due to missing target data";
    } else {
        poolId3 = window.getPoolId(currentPair, "currentPair_route");
        try { fee3 = await window.getPoolFeeFromRpc(poolId3); } catch (e) { stepSpecificError = "Fee fetch error (Step 3)"; fee3 = "Error"; }
    }
    steps[2] = {
        poolId: poolId3, swapFee: fee3,
        fromToken: tokenB_Shared_Details,
        toToken: tokenC_Details,
        poolProvider: currentPair?.name || "Target Pair",
        ...(stepSpecificError && { error: stepSpecificError })
    };

    // --- Build Step 4: Token C -> OSMO (on Intermediary Exit Pool) ---
    stepSpecificError = null;
    let poolId4 = "N/A", fee4 = "N/A";
    if (!intermediaryPoolExit || !window.getPoolId(intermediaryPoolExit, "step4_id_check").match(/^\d+$/)) {
        stepSpecificError = "Exit pool data missing or has invalid numeric ID";
    } else {
        poolId4 = window.getPoolId(intermediaryPoolExit, "intermediaryPoolExit_route");
        try { fee4 = await window.getPoolFeeFromRpc(poolId4); } catch (e) { stepSpecificError = "Fee fetch error (Step 4)"; fee4 = "Error"; }
    }
    steps[3] = {
        poolId: poolId4, swapFee: fee4,
        fromToken: tokenC_Details,
        toToken: osmoDetails,
        poolProvider: intermediaryPoolExit?.name || "Intermediary Exit Pool",
        ...(stepSpecificError && { error: stepSpecificError })
    };

    // Final check to ensure all step slots are filled (should be by above logic)
    for (let i = 0; i < steps.length; i++) {
        if (!steps[i]) {
            steps[i] = {
                poolId: "N/A", swapFee: "N/A",
                fromToken: makeRouteTokenDetails("ERR_FROM", "err_denom", null, `Step ${i + 1} data generation failed`),
                toToken: makeRouteTokenDetails("ERR_TO", "err_denom", null, `Step ${i + 1} data generation failed`),
                error: `Step ${i + 1} data completely unresolved`,
                poolProvider: `Step ${i+1} Provider Unknown`
            };
        }
    }

    return {
        from: osmoDetails, // Overall start of the arbitrage path
        to: osmoDetails,   // Overall end of the arbitrage path
        steps: steps       // Array of 4 steps, each with fromToken, toToken, and potential error
    };
} // end createRouteObject


async function wrapNoOsmoJson(pair, token, minPrice, currentPrice, baselinePair, numiaDataFromCaller) {
    console.log(`[wrapNoOsmoJson] Starting for ${token} (${pair?.pairAddress}) with baseline ${baselinePair?.pairAddress}`);

    // Ensure BigNumber is available
    if (typeof BigNumber === 'undefined' && typeof window.BigNumber !== 'undefined') {
      BigNumber = window.BigNumber;
    } else if (typeof BigNumber === 'undefined') {
      console.error("BigNumber is not defined. Please include bignumber.js.");
      const errRoute = await createRouteObject(pair, baselinePair, null, null, null);
      return { flashLoan: null, route: errRoute, error: "BigNumber library missing." };
    }

    // Access global constants or use defaults
    const FLASH_LOAN_AMOUNT = String(window.FLASH_LOAN_AMOUNT || "10000000");
    const SLIPPAGE_TOLERANCE = parseFloat(window.SLIPPAGE_TOLERANCE || 0.005);

    const toBase64 = (obj) => {
        try {
            const jsonString = JSON.stringify(obj);
            return btoa(unescape(encodeURIComponent(jsonString))); // Handles UTF-8
        } catch (error) { console.error("Error encoding to Base64:", error, obj); throw error; }
    };

    let routeJson = null;
    let finalFlashLoanMsg = null;
    let topLevelError = null;

    // --- Determine Shared Token early ---
    const baselineBaseTokenAddress = baselinePair?.baseToken?.address;
    const baselineQuoteTokenAddress = baselinePair?.quoteToken?.address;
    const pairBaseTokenAddress = pair?.baseToken?.address;
    const pairQuoteTokenAddress = pair?.quoteToken?.address;
    let sharedTokenAddress = null;

    if (baselineBaseTokenAddress && baselineQuoteTokenAddress && pairBaseTokenAddress && pairQuoteTokenAddress) {
        if (pairBaseTokenAddress === baselineBaseTokenAddress || pairBaseTokenAddress === baselineQuoteTokenAddress) {
            sharedTokenAddress = pairBaseTokenAddress;
        } else if (pairQuoteTokenAddress === baselineBaseTokenAddress || pairQuoteTokenAddress === baselineQuoteTokenAddress) {
            sharedTokenAddress = pairQuoteTokenAddress;
        }
    }

    // --- Initial Condition Check ---
    if (!(currentPrice > minPrice * (1 + SLIPPAGE_TOLERANCE + 0.005) && baselinePair?.pairAddress && pair?.pairAddress && baselinePair?.pool_id && pair?.pool_id)) { // Added pool_id checks
        topLevelError = "Initial arbitrage condition not met or core pair data missing (incl. pool_id).";
        console.warn(`[wrapNoOsmoJson] ${topLevelError} for ${token}`);
        routeJson = await createRouteObject(pair, baselinePair, null, null, sharedTokenAddress);
        return { flashLoan: null, route: routeJson, error: topLevelError };
    }

    if (!sharedTokenAddress) {
        topLevelError = "No shared token found between baseline and target pairs.";
        console.warn(`[wrapNoOsmoJson] ${topLevelError} for ${token}`);
        routeJson = await createRouteObject(pair, baselinePair, null, null, sharedTokenAddress);
        return { flashLoan: null, route: routeJson, error: topLevelError };
    }
    console.log(`[wrapNoOsmoJson] Initial condition MET for ${token}. Shared token: ${sharedTokenAddress.slice(-6)}`);

    // --- Fetch Intermediary Pools ---
    let intermediaryPoolEnter = null;
    let intermediaryPoolExit = null;
    try {
        if (typeof window.fetchAndMatchDexscreenerPool !== 'function') throw new Error("fetchAndMatchDexscreenerPool not found");
        // Pass numiaDataFromCaller (which might be the full array from window.numiaDataSwap)
        [intermediaryPoolEnter, intermediaryPoolExit] = await Promise.all([
            window.fetchAndMatchDexscreenerPool(pair, baselinePair, numiaDataFromCaller),
            window.fetchAndMatchDexscreenerPool(baselinePair, pair, numiaDataFromCaller)
        ]);
        console.log(`[wrapNoOsmoJson] Intermediary pools fetched for ${token}: Enter: ${!!intermediaryPoolEnter}, Exit: ${!!intermediaryPoolExit}`);
    } catch (err) {
        topLevelError = `Failed to fetch intermediary pools: ${err.message}`;
        console.error(`[wrapNoOsmoJson] ${topLevelError} for ${token}`);
        // Fall through to createRouteObject, which will show errors for these missing pools
    }

    // --- ALWAYS Create Route Object ---
    routeJson = await createRouteObject(pair, baselinePair, intermediaryPoolEnter, intermediaryPoolExit, sharedTokenAddress);

    // --- Attempt to build Flash Loan (only if essential pools for execution were found) ---
    if (!intermediaryPoolEnter || !intermediaryPoolEnter.poolAddress || !intermediaryPoolEnter.pool_num ||
        !intermediaryPoolExit || !intermediaryPoolExit.poolAddress || !intermediaryPoolExit.pool_num) {
        topLevelError = topLevelError || "One or both intermediary pools (Enter/Exit) are invalid for execution.";
        console.warn(`[wrapNoOsmoJson] ${topLevelError} for ${token}`);
    } else {
        // Proceed with execution message generation
        try {
            const swapMsgs = [];
            // Get IDs for execution fee fetching
            const poolIdEnterExec = window.getPoolId(intermediaryPoolEnter, "poolIdEnterExec");
            const poolIdBaselineExec = window.getPoolId(baselinePair, "poolIdBaselineExec");
            const poolIdTargetExec = window.getPoolId(pair, "poolIdTargetExec");
            const poolIdExitExec = window.getPoolId(intermediaryPoolExit, "poolIdExitExec");

            if (![poolIdEnterExec, poolIdBaselineExec, poolIdTargetExec, poolIdExitExec].every(id => id !== "N/A" && id.match(/^\d+$/))) {
                throw new Error("One or more pool IDs are invalid/non-numeric for fee fetching during execution path.");
            }

            const [fee1Str, fee2Str, fee3Str, fee4Str] = await Promise.all([
                window.getPoolFeeFromRpc(poolIdEnterExec), window.getPoolFeeFromRpc(poolIdBaselineExec),
                window.getPoolFeeFromRpc(poolIdTargetExec), window.getPoolFeeFromRpc(poolIdExitExec)
            ]);
            const actualFee1 = !isNaN(parseFloat(fee1Str)) ? parseFloat(fee1Str) : FALLBACK_SWAP_FEE;
            const actualFee2 = !isNaN(parseFloat(fee2Str)) ? parseFloat(fee2Str) : FALLBACK_SWAP_FEE;
            const actualFee3 = !isNaN(parseFloat(fee3Str)) ? parseFloat(fee3Str) : FALLBACK_SWAP_FEE;
            const actualFee4 = !isNaN(parseFloat(fee4Str)) ? parseFloat(fee4Str) : FALLBACK_SWAP_FEE;
            console.log(`[wrapNoOsmoJson Execution Fees for ${token}] Enter: ${actualFee1}, Baseline: ${actualFee2}, Target: ${actualFee3}, Exit: ${actualFee4}`);

            // Variables for amounts and addresses through the swap path
            let acquiredTokenAddressStep1, acquiredAmountStep1_str, acquiredDecimalsStep1;
            let acquiredTokenAddressStep2, acquiredAmountStep2_str, acquiredDecimalsStep2;
            let acquiredTokenAddressStep3, acquiredAmountStep3_str, acquiredDecimalsStep3;
            let expectedReturnOsmoAmount_BN;

            // --- Step 1 Calc: OSMO -> Token A (on Intermediary Enter Pool) ---
            const enterPoolPrice = intermediaryPoolEnter.priceNative ? parseFloat(intermediaryPoolEnter.priceNative) : null;
            if (enterPoolPrice === null || isNaN(enterPoolPrice)) throw new Error("Enter pool price invalid for execution.");
            const isBaseOsmoEnter = intermediaryPoolEnter.baseToken.address === OSMO_DENOM;
            acquiredTokenAddressStep1 = isBaseOsmoEnter ? intermediaryPoolEnter.quoteToken.address : intermediaryPoolEnter.baseToken.address;
            acquiredDecimalsStep1 = isBaseOsmoEnter ? (intermediaryPoolEnter.quoteToken.decimals ?? 6) : (intermediaryPoolEnter.baseToken.decimals ?? 6);
            let beliefPrice1; let expectedAmountStep1_BN;
            const offerAssetInfo1 = { info: { native_token: { denom: OSMO_DENOM } }, amount: FLASH_LOAN_AMOUNT };
            const askAssetInfo1 = { info: { token: { contract_addr: acquiredTokenAddressStep1 } } };
            if (isBaseOsmoEnter) {
                beliefPrice1 = new BigNumber(enterPoolPrice).multipliedBy(1 + SLIPPAGE_TOLERANCE).toFixed(18);
                expectedAmountStep1_BN = new BigNumber(FLASH_LOAN_AMOUNT).shiftedBy(-OSMO_DECIMALS).dividedBy(enterPoolPrice).multipliedBy(1 - actualFee1).multipliedBy(1 - SLIPPAGE_TOLERANCE);
            } else {
                beliefPrice1 = new BigNumber(enterPoolPrice).multipliedBy(1 - SLIPPAGE_TOLERANCE).toFixed(18);
                expectedAmountStep1_BN = new BigNumber(FLASH_LOAN_AMOUNT).shiftedBy(-OSMO_DECIMALS).multipliedBy(enterPoolPrice).multipliedBy(1 - actualFee1).multipliedBy(1 - SLIPPAGE_TOLERANCE);
            }
            acquiredAmountStep1_str = expectedAmountStep1_BN.shiftedBy(acquiredDecimalsStep1).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
            if (acquiredAmountStep1_str === "0") throw new Error("Step 1 calc resulted in zero amount for execution.");
            const swapMsg1 = { swap: { offer_asset: offerAssetInfo1, ask_asset_info: askAssetInfo1, belief_price: beliefPrice1, max_spread: String(SLIPPAGE_TOLERANCE) } };
            swapMsgs.push({ wasm: { execute: { contract_addr: intermediaryPoolEnter.poolAddress, msg: toBase64(swapMsg1), funds: [{ denom: OSMO_DENOM, amount: FLASH_LOAN_AMOUNT }] } } });

            // --- Step 2 Calc: Token A -> Token B (Shared) (on Baseline Pair) ---
            const baselinePrice = baselinePair.priceNative ? parseFloat(baselinePair.priceNative) : null;
            if (baselinePrice === null || isNaN(baselinePrice)) throw new Error("Baseline pool price invalid for execution.");
            acquiredTokenAddressStep2 = sharedTokenAddress;
            acquiredDecimalsStep2 = (sharedTokenAddress === baselineBaseTokenAddress) ? (baselinePair.baseToken.decimals ?? 6) : (baselinePair.quoteToken.decimals ?? 6);
            let beliefPrice2; let expectedAmountStep2_BN;
            const offerAssetInfo2 = { info: { token: { contract_addr: acquiredTokenAddressStep1 } }, amount: acquiredAmountStep1_str };
            const askAssetInfo2 = { info: { token: { contract_addr: acquiredTokenAddressStep2 } } };
            const offerAmountStep2_BN = new BigNumber(acquiredAmountStep1_str).shiftedBy(-acquiredDecimalsStep1);
            if (baselineBaseTokenAddress === acquiredTokenAddressStep1) { // Offering Base (A)
                if (baselineQuoteTokenAddress !== sharedTokenAddress) throw new Error("Logic error: baseline quote not shared.");
                beliefPrice2 = new BigNumber(baselinePrice).multipliedBy(1 + SLIPPAGE_TOLERANCE).toFixed(18);
                expectedAmountStep2_BN = offerAmountStep2_BN.dividedBy(baselinePrice).multipliedBy(1 - actualFee2).multipliedBy(1 - SLIPPAGE_TOLERANCE);
            } else { // Offering Quote (A)
                if (baselineBaseTokenAddress !== sharedTokenAddress) throw new Error("Logic error: baseline base not shared.");
                beliefPrice2 = new BigNumber(baselinePrice).multipliedBy(1 - SLIPPAGE_TOLERANCE).toFixed(18);
                expectedAmountStep2_BN = offerAmountStep2_BN.multipliedBy(baselinePrice).multipliedBy(1 - actualFee2).multipliedBy(1 - SLIPPAGE_TOLERANCE);
            }
            acquiredAmountStep2_str = expectedAmountStep2_BN.shiftedBy(acquiredDecimalsStep2).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
            if (acquiredAmountStep2_str === "0") throw new Error("Step 2 calc resulted in zero amount for execution.");
            const swapMsg2 = { swap: { offer_asset: offerAssetInfo2, ask_asset_info: askAssetInfo2, belief_price: beliefPrice2, max_spread: String(SLIPPAGE_TOLERANCE) } };
            swapMsgs.push({ wasm: { execute: { contract_addr: baselinePair.poolAddress, msg: toBase64(swapMsg2), funds: [] } } }); // TODO: Allowance

            // --- Step 3 Calc: Token B (Shared) -> Token C (on Target Pair) ---
            const targetPrice = pair.priceNative ? parseFloat(pair.priceNative) : null;
            if (targetPrice === null || isNaN(targetPrice)) throw new Error("Target pool price invalid for execution.");
            const isSharedBaseTarget = pairBaseTokenAddress === sharedTokenAddress;
            acquiredTokenAddressStep3 = isSharedBaseTarget ? pairQuoteTokenAddress : pairBaseTokenAddress;
            acquiredDecimalsStep3 = isSharedBaseTarget ? (pair.quoteToken.decimals ?? 6) : (pair.baseToken.decimals ?? 6);
            let beliefPrice3; let expectedAmountStep3_BN;
            const offerAssetInfo3 = { info: { token: { contract_addr: acquiredTokenAddressStep2 } }, amount: acquiredAmountStep2_str };
            const askAssetInfo3 = { info: { token: { contract_addr: acquiredTokenAddressStep3 } } };
            const offerAmountStep3_BN = new BigNumber(acquiredAmountStep2_str).shiftedBy(-acquiredDecimalsStep2);
            if (isSharedBaseTarget) { // Offering Base (B/Shared)
                beliefPrice3 = new BigNumber(targetPrice).multipliedBy(1 + SLIPPAGE_TOLERANCE).toFixed(18);
                expectedAmountStep3_BN = offerAmountStep3_BN.dividedBy(targetPrice).multipliedBy(1 - actualFee3).multipliedBy(1 - SLIPPAGE_TOLERANCE);
            } else { // Offering Quote (B/Shared)
                beliefPrice3 = new BigNumber(targetPrice).multipliedBy(1 - SLIPPAGE_TOLERANCE).toFixed(18);
                expectedAmountStep3_BN = offerAmountStep3_BN.multipliedBy(targetPrice).multipliedBy(1 - actualFee3).multipliedBy(1 - SLIPPAGE_TOLERANCE);
            }
            acquiredAmountStep3_str = expectedAmountStep3_BN.shiftedBy(acquiredDecimalsStep3).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
            if (acquiredAmountStep3_str === "0") throw new Error("Step 3 calc resulted in zero amount for execution.");
            const swapMsg3 = { swap: { offer_asset: offerAssetInfo3, ask_asset_info: askAssetInfo3, belief_price: beliefPrice3, max_spread: String(SLIPPAGE_TOLERANCE) } };
            swapMsgs.push({ wasm: { execute: { contract_addr: pair.poolAddress, msg: toBase64(swapMsg3), funds: [] } } }); // TODO: Allowance

            // --- Step 4 Calc: Token C -> OSMO (on Intermediary Exit Pool) ---
            const exitPoolPrice = intermediaryPoolExit.priceNative ? parseFloat(intermediaryPoolExit.priceNative) : null;
            if (exitPoolPrice === null || isNaN(exitPoolPrice)) throw new Error("Exit pool price invalid for execution.");
            const isTokenCBaseExit = intermediaryPoolExit.baseToken.address === acquiredTokenAddressStep3;
            let beliefPrice4;
            const offerAssetInfo4 = { info: { token: { contract_addr: acquiredTokenAddressStep3 } }, amount: acquiredAmountStep3_str };
            const askAssetInfo4 = { info: { native_token: { denom: OSMO_DENOM } } };
            const offerAmountStep4_BN = new BigNumber(acquiredAmountStep3_str).shiftedBy(-acquiredDecimalsStep3);
            if (isTokenCBaseExit) { // Offering Base (C)
                beliefPrice4 = new BigNumber(exitPoolPrice).multipliedBy(1 - SLIPPAGE_TOLERANCE).toFixed(18); // Sell high for C vs OSMO
                expectedReturnOsmoAmount_BN = offerAmountStep4_BN.multipliedBy(exitPoolPrice).multipliedBy(1 - actualFee4).multipliedBy(1 - SLIPPAGE_TOLERANCE);
            } else { // Offering Quote (C)
                beliefPrice4 = new BigNumber(1).dividedBy(new BigNumber(exitPoolPrice).multipliedBy(1 + SLIPPAGE_TOLERANCE)).toFixed(18); // Buy OSMO low with C
                expectedReturnOsmoAmount_BN = offerAmountStep4_BN.dividedBy(exitPoolPrice).multipliedBy(1 - actualFee4).multipliedBy(1 - SLIPPAGE_TOLERANCE);
            }
            const swapMsg4 = { swap: { offer_asset: offerAssetInfo4, ask_asset_info: askAssetInfo4, belief_price: beliefPrice4, max_spread: String(SLIPPAGE_TOLERANCE) } };
            swapMsgs.push({ wasm: { execute: { contract_addr: intermediaryPoolExit.poolAddress, msg: toBase64(swapMsg4), funds: [] } } }); // TODO: Allowance

            // All messages constructed, form the final flash loan message
            finalFlashLoanMsg = {
                flash_loan: {
                    assets: [{ info: { native_token: { denom: OSMO_DENOM } }, amount: FLASH_LOAN_AMOUNT }],
                    msgs: swapMsgs,
                },
            };

            // Profit Check
            const expectedReturnOsmo_str = expectedReturnOsmoAmount_BN.shiftedBy(OSMO_DECIMALS).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
            const profit = new BigNumber(expectedReturnOsmo_str).minus(FLASH_LOAN_AMOUNT);
            console.log(`[wrapNoOsmoJson EXEC PROFIT CHECK for ${token}] Expected Return: ${expectedReturnOsmo_str} uOSMO, Loan: ${FLASH_LOAN_AMOUNT} uOSMO, Profit: ${profit.toString()} uOSMO`);
            if (profit.isLessThanOrEqualTo(0)) {
                topLevelError = "Path not profitable for execution after calculations.";
                console.warn(`[wrapNoOsmoJson] ${topLevelError} for ${token}`);
                finalFlashLoanMsg = null; // Don't execute non-profitable
            } else {
                 console.log(`[wrapNoOsmoJson] Profitable path found for ${token}! Profit: ${profit.toString()} uOSMO`);
            }

        } catch (execError) {
            topLevelError = `Execution message construction failed: ${execError.message}`;
            console.warn(`[wrapNoOsmoJson] ${topLevelError} for ${token}`, execError);
            finalFlashLoanMsg = null;
        }
    }

    // --- Final Return ---
    console.log(`[wrapNoOsmoJson] Returning for ${token}. FlashLoan: ${!!finalFlashLoanMsg}, Route: ${!!routeJson}, TopLevelError: ${topLevelError || 'None'}`);
    return { flashLoan: finalFlashLoanMsg, route: routeJson, error: topLevelError };

} // end wrapNoOsmoJson

// Make sure to expose it globally if not using modules
window.wrapNoOsmoJson = wrapNoOsmoJson;
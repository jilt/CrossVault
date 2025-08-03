// fetchData.js

// Assume these constants are defined globally or replace with actual values/imports
const WHITE_WHALE_FLASHLOAN_CONTRACT_ADDRESS = "osmo1javcdeqdnlujsrl4kduwfcs2cw5hd4jz9vh2wdpqyz6kp2tn8e9qt0rz8g";
const SLIPPAGE_TOLERANCE = 0.005; // Example: 0.5% slippage tolerance
const FALLBACK_SWAP_FEE = 0.002; // Use a reasonable fallback if RPC fee fetch fails (e.g., 0.2%)
const FLASH_LOAN_AMOUNT = "10000000"; // Example: 10 OSMO in uosmo
const OSMO_DENOM = "uosmo"; // Define OSMO denom as a constant
const OSMO_DECIMALS = 6; // Define OSMO decimals
const NUMIA_AUTH_TOKEN = '*****************************'; // Keep your API key secure!
let tokens = [ // Example global tokens list, used if baseline/pair are identical
    'ibc/D1542AA8762DB13087D8364F3EA6509FD6F009A34F00426AF9E4F9FA85CBBF1F', // WBTC
    'factory/osmo17fel472lgzs87ekt9dvk0zqyh5gl80sqp4sk4n/LAB',
    'ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877',
    'ibc/EC3A4ACBA1CFBEE698472D3563B70985AEA5A7144C319B61B3EBDFB57B5E1535',
    'ibc/46B44899322F3CD854D2D46DEEF881958467CDD4B3B10086DA49296BBED94BED', // ATOM
    'ibc/1480B8FD20AD5FCAE81EA87584D269547DD4D436843C1D20F15E00EB64743EF4', // IST
    'ibc/903A61A498756EA560B85A85132D3AEE21B5DEDD41213725D22ABF276EA6945E', // DAI
    'ibc/64BA6E31FE887D66C6F8F31C7B1A80C7CA179239677B4088BB55F5EA07DBE273', // USDC
    'ibc/C140AFD542AE77BD7DCC83F13FDD8C5E5BB8C4929785E6EC2F4C636F98F17901', // Stride Staked ATOM (stATOM)
    'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2' // USDC.axl
];

 // Helper to safely get pool ID
 const getPoolId = (poolObj, sourceName) => {
    const id = poolObj?.pool_id?.toString() || poolObj?.poolId?.toString() || poolObj?.id?.toString() || (poolObj?.pairAddress ? poolObj.pairAddress.split('-')[0] : null) || poolObj?.poolAddress;
    if (id && isNaN(parseInt(id))) {
         console.warn(`Identifier for ${sourceName} (${id}) is not a numeric pool ID.`);
         return "N/A";
    }
    if (!id) console.warn(`Missing pool identifier for ${sourceName}`);
    return id || "N/A";
};

async function fetchData(token) {
    try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${token}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Error fetching data for ${token}:`, error);
        return null;
    }
}
/**
 * Fetches the swap fee/spread factor for a given pool ID from the Osmosis LCD.
 * Checks for spread_factor, spread, and swap_fee fields in the response.
 * @param {string | number} poolId The ID of the pool.
 * @returns {Promise<string>} The fee as a standard decimal string (e.g., "0.002"),
 * or "N/A" if not found/fetch error,
 * or "Error" on exception,
 * or "0" for invalid poolId input.
 */
async function getPoolFeeFromRpc(poolId) {
    // Basic validation for poolId
    if (!poolId || poolId === "N/A" || poolId === 0 || poolId === "0") {
        console.warn(`Invalid poolId provided for fee fetch: ${poolId}`);
        return "0"; // Default fee for invalid ID
    }

    // Use the specified Keplr LCD endpoint
    const endpoint = `https://lcd-osmosis.keplr.app/osmosis/gamm/v1beta1/pools/${poolId}`;

    try {
        const response = await fetch(endpoint);
        if (!response.ok) {
            // Log specific statuses differently for clarity
            if (response.status === 404 || response.status === 500) {
                 console.warn(`Pool ${poolId} not found or query error via LCD [${response.status}]: ${endpoint}`);
            } else if (response.status === 400) {
                 console.warn(`Bad request for pool ${poolId} (potentially wrong type for endpoint?) [${response.status}]: ${endpoint}`);
            } else {
                 console.error(`LCD query failed for pool ${poolId} [${response.status}]: ${endpoint}`);
            }
            return "N/A"; // Indicate fee couldn't be fetched
        }
        const poolData = await response.json();

        // Extract the fee - Check potential fields in order of priority/likelihood
        // We check multiple locations as response structure can vary slightly
        let feeValue = null;
        const poolDirect = poolData?.pool; // Pool object
        const poolParams = poolData?.pool?.pool_params; // Standard GAMM pool params path

        if (poolDirect?.spread_factor) { // Check for CL pool spread_factor first
            feeValue = poolDirect.spread_factor;
            // console.log(`Pool ${poolId}: Found fee in pool.spread_factor`); // Optional debug log
        } else if (poolParams?.spread) { // Check spread under pool_params (user mentioned)
             feeValue = poolParams.spread;
             // console.log(`Pool ${poolId}: Found fee in pool.pool_params.spread`); // Optional debug log
        } else if (poolDirect?.spread) { // Check spread directly under pool (user mentioned)
             feeValue = poolDirect.spread;
             // console.log(`Pool ${poolId}: Found fee in pool.spread`); // Optional debug log
        } else if (poolParams?.swap_fee) { // Fallback 1: Standard GAMM swap_fee location
             feeValue = poolParams.swap_fee;
             // console.log(`Pool ${poolId}: Found fee in pool.pool_params.swap_fee`); // Optional debug log
        } else if (poolDirect?.swap_fee) { // Fallback 2: GAMM swap_fee directly under pool
            feeValue = poolDirect.swap_fee;
            // console.log(`Pool ${poolId}: Found fee in pool.swap_fee`); // Optional debug log
        }

        // Process the found feeValue
        if (typeof feeValue === 'string') {
            // Parse the decimal string (e.g., "0.002000000000000000")
            const feeNum = parseFloat(feeValue);
            if (!isNaN(feeNum)) {
                // Return the standard decimal string representation (e.g., "0.002", "0.0001")
                return feeNum.toString();
            } else {
                 // Log if parsing failed
                 console.warn(`Parsed feeValue for pool ${poolId} is NaN: '${feeValue}'`);
            }
        }

        // If feeValue wasn't found or wasn't a valid string after checking all possibilities
        console.warn(`Could not find or parse a valid fee ('spread_factor', 'spread', or 'swap_fee') for pool ${poolId} from LCD response.`);
        // console.log(`Pool ${poolId} Data Received:`, poolData); // Uncomment for deeper debugging if needed
        return "N/A"; // Indicate parsing failure or fee not found

    } catch (error) {
        console.error(`Error fetching/processing fee for pool ${poolId} from LCD [${endpoint}]:`, error);
        return "Error"; // Indicate fetch/processing error
    }
}

// --- Improved Numia Data Handling with Caching and Pagination ---

// Cache for Numia data to avoid re-fetching on every call
let numiaPairsCache = null;
let isFetchingNumiaData = false;
let fetchNumiaPromise = null;

/**
 * Fetches all pairs from the Numia API, handling pagination correctly.
 * It caches the result to avoid redundant network requests.
 * @returns {Promise<Array|null>} A promise that resolves to an array of all pairs, or null on error.
 */
async function getOrFetchAllNumiaPairs() {
    // If we already have the data, return it from the cache
    if (numiaPairsCache) {
        return numiaPairsCache;
    }

    // If a fetch is already in progress, wait for it to complete to avoid duplicate requests
    if (isFetchingNumiaData) {
        return await fetchNumiaPromise;
    }

    // Start a new fetch process
    isFetchingNumiaData = true;
    fetchNumiaPromise = (async () => {
        console.log("Starting to fetch all Numia pairs with pagination...");
        const allPairs = [];
        const limit = 1000; // Numia supports a 'limit' parameter
        let offset = 0;
        let hasMore = true;

        try {
            while (hasMore) {
                const url = `https://osmosis.numia.xyz/pairs/v2/summary?limit=${limit}&offset=${offset}`;
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${NUMIA_AUTH_TOKEN}` }
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                const pageData = await response.json();
                const pairsInPage = pageData.data;

                if (pairsInPage && Array.isArray(pairsInPage) && pairsInPage.length > 0) {
                    allPairs.push(...pairsInPage);
                    offset += pairsInPage.length;
                    // If we received fewer items than the limit, we've reached the end
                    hasMore = pairsInPage.length === limit;
                } else {
                    hasMore = false; // No more data to fetch
                }
            }

            console.log(`Successfully fetched a total of ${allPairs.length} pairs from Numia.`);
            numiaPairsCache = allPairs; // Cache the full list for subsequent calls
            return allPairs;
        } catch (error) {
            console.error('Error fetching paginated Numia data:', error);
            numiaPairsCache = null; // Clear cache on error
            return null;
        } finally {
            isFetchingNumiaData = false; // Reset fetching state
            fetchNumiaPromise = null;
        }
    })();

    return await fetchNumiaPromise;
}

/**
 * Finds a contract address for a given pool ID using the cached Numia data.
 * @param {string | number} poolId The ID of the pool to find.
 * @returns {Promise<string|null>} The pool's contract address or null if not found.
 */
async function fetchNumiaContractAddress(poolId) {
    const allNumiaPairs = await getOrFetchAllNumiaPairs();

    if (allNumiaPairs && Array.isArray(allNumiaPairs)) {
        const poolIdStr = poolId?.toString();
        const foundPool = allNumiaPairs.find(item => item.pool_id === poolIdStr);

        return foundPool?.pool_address || null;
    } else {
        console.error("Numia data could not be fetched or is not an array. Cannot find contract address.");
        return null;
    }
}

async function fetchAndMatchDexscreenerPool(pair, baselinePair) {
    // --- Initial Setup & Hardcoded Checks ---
    const wbtcEthAxlAddress = 'ibc/D1542AA8762DB13087D8364F3EA6509FD6F009A34F00426AF9E4F9FA85CBBF1F';
    const specificPoolAddress = 'osmo13l9nyqrn2q5fce89hp4jymhsrmn6yh6m4xsjxp4p6pakp82z76nqv6vk7f';
    const OMAddress = 'ibc/164807F6226F91990F358C6467EEE8B162E437BDCD3DADEC3F0CE20693720795';
    const specificOMPoolAddress = 'osmo1vzqw56gravz4npt5sxgm2uz7c0ny8fhuxvq9zwmtq26qp8m7mr5s2cac96';
    const specificTIAPoolAddress = 'osmo1emr5hycqzrlrd9cdm9j3jxs66detx2j69mde2xxxsj8xhnl3dvmsgpudk6';
    const specificmilkTIAPoolAddress = 'osmo1n25j7fxdzzet52tkqqtyc04ruc6ffrmh4ytk0n5rpzeh0k0aar0sh3mch6';
    let targetIntermediarySymbol = null;
    let targetIntermediaryAddress = null;

    // Ensure baselinePair and its tokens are valid
    if (!baselinePair || !baselinePair.baseToken?.symbol || !baselinePair.quoteToken?.symbol || !baselinePair.baseToken?.address || !baselinePair.quoteToken?.address) {
         console.warn("fetchAndMatchDexscreenerPool: BaselinePair object is missing necessary token information.");
         return null;
    }
     // Ensure pair and its tokens are valid (needed for symbol checks)
     if (!pair || !pair.baseToken?.symbol || !pair.quoteToken?.symbol || !pair.baseToken?.address || !pair.quoteToken?.address) {
         console.warn("fetchAndMatchDexscreenerPool: Pair object is missing necessary token information.");
         return null;
     }

    const baselineBaseSymbol = baselinePair.baseToken.symbol;
    const baselineQuoteSymbol = baselinePair.quoteToken.symbol;
    const baselineBaseAddress = baselinePair.baseToken.address;
    const baselineQuoteAddress = baselinePair.quoteToken.address;

    // Handle specific hardcoded pools first
    if (((baselineBaseAddress === OSMO_DENOM && baselineQuoteAddress === wbtcEthAxlAddress) || (baselineQuoteAddress === OSMO_DENOM && baselineBaseAddress === wbtcEthAxlAddress))) {
        console.log("Matched specific WBTC/OSMO pool:", specificPoolAddress);
        return { poolAddress: specificPoolAddress /* , ... potentially add other known details */ };
    }
    if (baselineBaseAddress === OMAddress || baselineQuoteAddress === OMAddress) {
        console.log('Matched specific OM/OSMO pool:', specificOMPoolAddress);
        return { poolAddress: specificOMPoolAddress /* , ... potentially add other known details */ };
    }
    if (baselinePair.baseToken.symbol === 'TIA' || baselinePair.quoteToken.symbol === 'TIA') {
        console.log('Matched specific TIA/OSMO pool:', specificTIAPoolAddress);
        return { poolAddress: specificTIAPoolAddress, poolId: "1248" /* , ... potentially add other known details */ };
    }
    if (baselinePair.baseToken.symbol === 'milkTIA' || baselinePair.quoteToken.symbol === 'milkTIA') {
        console.log('Matched specific milkTIA/OSMO pool:', specificmilkTIAPoolAddress);
        return { poolAddress: specificmilkTIAPoolAddress, poolId: "1460" /* , ... potentially add other known details */ };
    }

    // --- Logic to Identify Target Intermediary Token ---
    // This logic determines which OSMO pool to search for on Dexscreener

    const baselineHasOsmo = (baselineBaseSymbol === 'OSMO' || baselineQuoteSymbol === 'OSMO');
    const pairHasOsmo = (pair.baseToken.symbol === 'OSMO' || pair.quoteToken.symbol === 'OSMO');

    if (baselineHasOsmo) {
        // CASE 1: Baseline Pair HAS OSMO
        // Find the non-OSMO token in baseline that is NOT in the target pair symbols.
        const pairSymbols = [pair.baseToken.symbol, pair.quoteToken.symbol];
        if (baselineBaseSymbol !== 'OSMO' && !pairSymbols.includes(baselineBaseSymbol)) {
            targetIntermediarySymbol = baselineBaseSymbol;
            targetIntermediaryAddress = baselineBaseAddress;
        } else if (baselineQuoteSymbol !== 'OSMO' && !pairSymbols.includes(baselineQuoteSymbol)) {
            targetIntermediarySymbol = baselineQuoteSymbol;
            targetIntermediaryAddress = baselineQuoteAddress;
        }
        // If no suitable token found in this case, targetIntermediarySymbol remains null.

    } else {
        // CASE 2: Baseline Pair does NOT have OSMO (User referred to this as "third case")

        if (pairHasOsmo) {
            // *** Subcase: Baseline NO OSMO, Pair HAS OSMO (Context of wrapPairOsmoJson call) ***
            // Goal: Find the OSMO pool for the token in baselinePair that is NOT shared with pair.

            // 1. Find the non-OSMO token symbol in the TARGET pair ('pair' object)
            const targetPairNonOsmoSymbol = pair.baseToken.symbol === 'OSMO' ? pair.quoteToken.symbol : pair.baseToken.symbol;

            // 2. Choose the token from baselinePair that is NOT the targetPair's non-OSMO token
            if (baselineBaseSymbol !== targetPairNonOsmoSymbol) {
                // Baseline's Base token IS the non-shared one. Target it.
                targetIntermediarySymbol = baselineBaseSymbol;
                targetIntermediaryAddress = baselineBaseAddress;
                console.log(`Selecting non-shared baseline token: ${targetIntermediarySymbol} (Target non-OSMO: ${targetPairNonOsmoSymbol})`);
            } else if (baselineQuoteSymbol !== targetPairNonOsmoSymbol) {
                // Baseline's Quote token IS the non-shared one. Target it.
                targetIntermediarySymbol = baselineQuoteSymbol;
                targetIntermediaryAddress = baselineQuoteAddress;
                console.log(`Selecting non-shared baseline token: ${targetIntermediarySymbol} (Target non-OSMO: ${targetPairNonOsmoSymbol})`);
            } else {
                // Edge case: Both baseline tokens ARE the same as the target's non-OSMO token.
                console.warn(`WorkspaceAndMatchDexscreenerPool: Both baseline tokens (${baselineBaseSymbol}, ${baselineQuoteSymbol}) seem to match target non-OSMO token (${targetPairNonOsmoSymbol}). Defaulting target search to ${baselineBaseSymbol}.`);
                targetIntermediarySymbol = baselineBaseSymbol;
                targetIntermediaryAddress = baselineBaseAddress;
            }
        } else {
             // Subcase: Baseline NO OSMO, Pair NO OSMO
             // (Context for wrapNoOsmoJson enter/exit steps)
             // We just need to find *an* OSMO link for one of the baseline tokens.
             // Defaulting to baseline's base token is reasonable here.
             console.log("Neither baseline nor pair has OSMO. Defaulting target to baseline's base token for OSMO link search.");
             targetIntermediarySymbol = baselineBaseSymbol;
             targetIntermediaryAddress = baselineBaseAddress;
        }
    }

    // Check if we successfully identified a target token after all logic branches
    if (!targetIntermediarySymbol || !targetIntermediaryAddress) {
       // This primarily catches failures from the 'baselineHasOsmo' branch where the
       // non-OSMO token *was* in the target pair, or if baselinePair was invalid.
       console.warn(`Could not identify a suitable intermediary token symbol/address to target after checks.`);
       return null; // Abort if no target identified
    }

    console.log(`Final target for OSMO pool search: OSMO <-> ${targetIntermediarySymbol} (Addr: ${targetIntermediaryAddress})`);


    // --- DexScreener Search & Pool Matching ---
    const dexscreenerEndpoint = `https://api.dexscreener.com/latest/dex/search?q=OSMO%20${targetIntermediarySymbol}`; // Use space for DexScreener query

    try {
        const response = await fetch(dexscreenerEndpoint);
        if (!response.ok) {
            console.error(`Dexscreener API request failed with status: ${response.status} for endpoint: ${dexscreenerEndpoint}`);
            return null; // Cannot proceed if DexScreener fails
        }
        const data = await response.json();

        if (data && data.pairs && Array.isArray(data.pairs) && data.pairs.length > 0) {
            // Sort pairs by liquidity (descending) to prioritize more liquid pools
             const sortedPools = data.pairs
                .filter(p => p.liquidity?.usd > 1000) // Basic liquidity filter
                .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

            let matchedPool = null;

            // Try to find the exact match by ADDRESS first (most reliable)
            matchedPool = sortedPools.find(p => {
                if (!p.baseToken?.address || !p.quoteToken?.address) return false;
                return (
                    (p.baseToken.address === OSMO_DENOM && p.quoteToken.address === targetIntermediaryAddress) ||
                    (p.quoteToken.address === OSMO_DENOM && p.baseToken.address === targetIntermediaryAddress)
                );
            });

            // Fallback: If no address match, try to match by SYMBOL (less reliable due to duplicates)
            if (!matchedPool) {
                console.warn(`No exact address match found for OSMO <-> ${targetIntermediaryAddress}. Falling back to symbol matching for OSMO <-> ${targetIntermediarySymbol}...`);
                matchedPool = sortedPools.find(p => {
                     if (!p.baseToken?.symbol || !p.quoteToken?.symbol) return false;
                     return (
                        (p.baseToken.symbol === 'OSMO' && p.quoteToken.symbol === targetIntermediarySymbol) ||
                        (p.quoteToken.symbol === 'OSMO' && p.baseToken.symbol === targetIntermediarySymbol)
                     );
                });
                 if (matchedPool) {
                     console.warn("Dexscreener pool matched by SYMBOL instead of address. Verification with Numia is important.");
                 }
            }

            // Process the matched pool (if found)
            if (matchedPool) {
                console.log(`Found potential pool on DexScreener: ${matchedPool.pairAddress} (Liquidity: $${matchedPool.liquidity?.usd})`);
                // Use the Dexscreener Pair Address for Numia Lookup
                const dexscreenerPairAddress = matchedPool.pairAddress;
                // Fetch the actual contract address from Numia using the POOL ID from dexscreener
                // Dexscreener often uses pool ID in pairAddress like '123-...' - extract it
                const poolIdFromDexscreener = dexscreenerPairAddress?.split('-')[0];
                let numiaContractAddress = null;
                if (poolIdFromDexscreener && !isNaN(parseInt(poolIdFromDexscreener))) {
                    numiaContractAddress = await window.fetchNumiaContractAddress(poolIdFromDexscreener);
                } else {
                    console.warn(`Could not extract numeric Pool ID from Dexscreener pairAddress: ${dexscreenerPairAddress}`);
                    // Optional: Could try lookup by dexscreenerPairAddress if fetchNumiaContractAddress supports it
                }


                if (!numiaContractAddress) {
                     console.warn(`Could not verify pool ${poolIdFromDexscreener || dexscreenerPairAddress} via Numia. Skipping this pool.`);
                     // Potentially loop to the next best pool from sortedPools if needed? For now, just fail.
                     return null;
                }
                 console.log(`Verified pool address via Numia: ${numiaContractAddress}`);

                // Construct return data using Numia address but Dexscreener details
                const returnData = {
                    poolAddress: numiaContractAddress, // Use the verified contract address
                    pool_num: poolIdFromDexscreener ? parseInt(poolIdFromDexscreener) : null, // Include pool ID if found
                    // Provide token details as found on Dexscreener for this pool
                    tokenSymbols: [matchedPool.baseToken?.symbol, matchedPool.quoteToken?.symbol],
                    priceNative: matchedPool.priceNative, // Keep as string from Dex
                    liquidity: matchedPool.liquidity?.usd,
                    baseToken: matchedPool.baseToken, // Include full base token object
                    quoteToken: matchedPool.quoteToken, // Include full quote token object
                    // Add swapFee placeholder - maybe fetch from getPoolFeeFromRpc here?
                    // swapFee: "FETCH_SEPARATELY" // Or null
                };
                return returnData;

            } else {
                console.warn(`No suitable pool found on DexScreener for OSMO <-> ${targetIntermediarySymbol} matching criteria.`);
                return null;
            }
        } else {
             console.warn(`No pairs found in Dexscreener response for query: OSMO ${targetIntermediarySymbol}`);
             return null;
        }
    } catch (error) {
        console.error(`Error fetching/processing data from Dexscreener API for ${targetIntermediarySymbol}:`, error);
        return null;
    }
} // end fetchAndMatchDexscreenerPool

// Helper function to compare arrays (simple value comparison)
function arraysAreEqual(arr1, arr2) {
    if (!arr1 || !arr2 || arr1.length !== arr2.length) return false;
    // Sort copies to handle different orders, then compare element-wise
    const sortedArr1 = [...arr1].sort();
    const sortedArr2 = [...arr2].sort();
    return sortedArr1.every((value, index) => value === sortedArr2[index]);
}

async function fetchAllPoolDataForToken(token) {
    try {
        const [dexscreenerResponse, numiaResponse] = await Promise.all([
            fetchData(token),          // Fetches from Dexscreener
            getOrFetchAllNumiaPairs()  // Fetches ALL pools from Numia with pagination
        ]);

        // Basic validation of responses
        if (!dexscreenerResponse || !dexscreenerResponse.pairs) {
            console.warn(`fetchAllPoolDataForToken: Dexscreener data is missing or invalid for token ${token}.`);
        }
        if (!numiaResponse || !Array.isArray(numiaResponse)) {
            console.warn(`fetchAllPoolDataForToken: Numia data is missing or not an array.`);
        }

        return {
            dexscreenerData: dexscreenerResponse, // The full response object from Dexscreener
            numiaData: numiaResponse || [] // The data array from Numia, or empty array on failure
        };
    } catch (error) {
        console.error(`Error in fetchAllPoolDataForToken for ${token}:`, error);
        return { dexscreenerData: null, numiaData: [] }; // Return a consistent shape on error
    }
}

// Assign functions to window object for global access
window.getOrFetchAllNumiaPairs = getOrFetchAllNumiaPairs; // Expose the new master fetcher
window.fetchNumiaContractAddress = fetchNumiaContractAddress; // Keep this for verification
window.fetchData = fetchData; // Original generic Dexscreener fetch
window.fetchAllPoolDataForToken = fetchAllPoolDataForToken;
window.fetchAndMatchDexscreenerPool = fetchAndMatchDexscreenerPool;
window.getPoolFeeFromRpc = getPoolFeeFromRpc;
window.getPoolId = getPoolId;
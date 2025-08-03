// displayGrid.js
// Modified to use the new unified data pipeline and wrapper functions.

const pairDataContainer = document.getElementById('pairData');
const settingsModal = document.getElementById('settingsModal');
const tokenListTextarea = document.getElementById('tokenList');
const mobileMenu = document.querySelector('.mobile-menu');
const menuItemsContainer = document.querySelector('.menu-items');
const tokenGridContainer = document.getElementById('tokenGridContainer');
let currentTokenData = {}; // Store fetched data for each token

function toggleMenu() {
    mobileMenu.classList.toggle('open');
}

async function displayGridForToken(token) {
    tokenGridContainer.innerHTML = ''; // Clear previous grid

    if (!currentTokenData[token]) {
        const combinedData = await window.fetchAllPoolDataForToken(token);
        if (combinedData) {
            currentTokenData[token] = combinedData;
        } else {
            tokenGridContainer.textContent = `No data available for ${token}`;
            return;
        }
    }

    const { dexscreenerData, numiaData } = currentTokenData[token];

    // --- Pool Unification Logic ---
    const unifiedPoolsMap = new Map();

    // First Pass: Process Numia data
    if (numiaData && Array.isArray(numiaData)) {
        numiaData.forEach(numiaPool => {
            const poolId = window.getPoolId(numiaPool, 'Numia');
            if (poolId === "N/A" || !numiaPool.pool_address) return;

            // Standardize Numia pool to a common format
            const standardizedPool = {
                pool_id: poolId,
                pairAddress: numiaPool.pool_address,
                baseToken: { symbol: numiaPool.base_symbol, address: numiaPool.base_address },
                quoteToken: { symbol: numiaPool.quote_symbol, address: numiaPool.quote_address },
                liquidity: { usd: parseFloat(numiaPool.liquidity_usd) || 0 },
                priceUsd: parseFloat(numiaPool.price) || 0,
                priceNative: numiaPool.price,
                source: 'numia'
            };
            unifiedPoolsMap.set(poolId, standardizedPool);
        });
    }

    // Second Pass: Process and merge Dexscreener data
    if (dexscreenerData && dexscreenerData.pairs && Array.isArray(dexscreenerData.pairs)) {
        dexscreenerData.pairs.forEach(dexPair => {
            const poolId = window.getPoolId(dexPair, 'Dexscreener');
            if (poolId === "N/A") return;

            if (unifiedPoolsMap.has(poolId)) {
                // Pool exists from Numia, enrich it with more detailed Dexscreener data
                const existingPool = unifiedPoolsMap.get(poolId);
                existingPool.priceUsd = parseFloat(dexPair.priceUsd) || existingPool.priceUsd;
                existingPool.liquidity = dexPair.liquidity || existingPool.liquidity;
                existingPool.priceNative = dexPair.priceNative || existingPool.priceNative;
                existingPool.baseToken = dexPair.baseToken; // Dexscreener token objects are more detailed
                existingPool.quoteToken = dexPair.quoteToken;
                existingPool.source = 'both'; // Mark as found in both
            } else {
                // Pool only exists on Dexscreener, add it
                dexPair.source = 'dexscreener';
                dexPair.pool_id = poolId; // Ensure a consistent pool_id field
                unifiedPoolsMap.set(poolId, dexPair);
            }
        });
    }

    const allUnifiedPools = Array.from(unifiedPoolsMap.values());

    // --- Apply Filters and Find Baseline on Unified Data ---
    const filteredPools = allUnifiedPools.filter(p => p.liquidity?.usd > 1000);

    if (filteredPools.length > 0) {
        let minPrice = Infinity;
        let baselinePair = null;
        let secondBaselineCandidate = null;
        let originalBaselinePairAddress = "";
        let osmoBaselinePair = null;

        // Calculate price and find baseline from the unified & filtered list
        for (const pair of filteredPools) {
            if (pair.baseToken.address !== token && pair.quoteToken.address !== token) {
                continue;
            }

            let priceToCheck = parseFloat(pair.priceUsd);
            if (pair.baseToken.address !== token) {
                // Ensure priceNative is not zero or invalid before division
                const nativePrice = parseFloat(pair.priceNative);
                if (nativePrice > 0) {
                    priceToCheck = (1 / nativePrice) * priceToCheck;
                }
            }

            const hasOsmo = (pair.baseToken.symbol === 'OSMO' || pair.quoteToken.symbol === 'OSMO');

            if (hasOsmo && priceToCheck < minPrice) {
                minPrice = priceToCheck;
                osmoBaselinePair = pair;
                originalBaselinePairAddress = pair.pairAddress;
                secondBaselineCandidate = baselinePair;
                baselinePair = pair;
            } else if (!osmoBaselinePair && priceToCheck < minPrice) {
                secondBaselineCandidate = baselinePair;
                minPrice = priceToCheck;
                baselinePair = pair;
                originalBaselinePairAddress = pair.pairAddress;
            } else if (!osmoBaselinePair && secondBaselineCandidate === null && baselinePair !== null && priceToCheck <= (parseFloat(baselinePair.priceUsd) * 1.01)) {
                secondBaselineCandidate = pair;
            }
        }

        // If we found an OSMO baseline pair, prioritize it
        if (osmoBaselinePair) {
            baselinePair = osmoBaselinePair;
        }

        currentTokenData[token].filteredPools = filteredPools;
        currentTokenData[token].baselinePairAddress = originalBaselinePairAddress;
        currentTokenData[token].secondBaselineCandidate = secondBaselineCandidate;

        const grid = document.createElement('div');
        grid.classList.add('token-grid');

        const displayToken = filteredPools[0].baseToken.address === token ? filteredPools[0].baseToken.symbol : filteredPools[0].quoteToken.symbol;
        const pageTitle = document.createElement('h2');
        pageTitle.textContent = displayToken;
        grid.appendChild(pageTitle);

        const pageSubtitle = document.createElement('div');
        pageSubtitle.classList.add('page-subtitle');
        pageSubtitle.textContent = `Baseline Pair: ${baselinePair ? baselinePair.pairAddress : 'N/A'}`;
        if (secondBaselineCandidate) {
            pageSubtitle.textContent += ` | Second Candidate: ${secondBaselineCandidate.pairAddress ? secondBaselineCandidate.pairAddress : 'N/A'}`;
        }
        grid.appendChild(pageSubtitle);

        const cardGrid = document.createElement('div');
        cardGrid.classList.add('token-grid');
        grid.appendChild(cardGrid);

        // --- Card Rendering Logic ---
        filteredPools.forEach(async pair => {
            const card = document.createElement('div');
            card.classList.add('grid-card');

            if (pair.baseToken.address !== token && pair.quoteToken.address !== token) {
                return;
            }

            let currentPrice = parseFloat(pair.priceUsd);
            if (pair.baseToken.address !== token) {
                const nativePrice = parseFloat(pair.priceNative);
                if (nativePrice > 0) {
                    currentPrice = (1 / nativePrice) * currentPrice;
                }
            }

            const isBaseline = (baselinePair && baselinePair.pairAddress === pair.pairAddress);

            // --- Arbitrage Opportunity Check ---
            if (currentPrice > minPrice * 1.025 && !isBaseline) {
                card.classList.add('highlight-red');

                const badge = document.createElement('div');
                badge.classList.add('badge');
                badge.style.display = 'flex';
                badge.style.alignItems = 'center';
                badge.style.gap = '5px';
                
                let jsonData = null;
                const currentBaseline = baselinePair;

                const pairHasOsmo = (pair.baseToken.symbol === 'OSMO' || pair.quoteToken.symbol === 'OSMO');
                const baselineHasOsmo = (currentBaseline?.baseToken?.symbol === 'OSMO' || currentBaseline?.quoteToken?.symbol === 'OSMO');

                // --- Call correct JSON wrapper based on context ---
                if (pairHasOsmo && baselineHasOsmo) {
                    jsonData = await window.wrapAllOsmoJson(pair, displayToken, minPrice, currentPrice, currentBaseline, filteredPools);
                } else if (pairHasOsmo && !baselineHasOsmo) {
                    jsonData = await window.wrapPairOsmoJson(pair, displayToken, minPrice, currentPrice, currentBaseline, filteredPools);
                } else if (!pairHasOsmo && baselineHasOsmo) {
                    jsonData = await window.wrapBaseOsmoJson(pair, displayToken, minPrice, currentPrice, currentBaseline, filteredPools);
                } else { // Neither has OSMO
                    jsonData = await window.wrapNoOsmoJson(pair, displayToken, minPrice, currentPrice, currentBaseline, filteredPools);
                }

                // Create link for flashloan JSON
                if (jsonData && jsonData.flashLoan) {
                    const jsonStringFlashLoan = JSON.stringify(jsonData.flashLoan, null, 2);
                    const downloadLinkFlashLoan = document.createElement('a');
                    downloadLinkFlashLoan.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStringFlashLoan);
                    downloadLinkFlashLoan.download = `flashloan_${pair.pairAddress}.json`;
                    downloadLinkFlashLoan.innerHTML = '<i class="material-icons">{ }</i>'; // JSON icon
                    badge.appendChild(downloadLinkFlashLoan);
                } else {
                    badge.innerHTML = '<i class="material-icons" style="opacity: 0.5;">{ }</i>';
                }

                // Create link for route JSON
                if (jsonData && jsonData.route) {
                    const jsonStringRoute = JSON.stringify(jsonData.route, null, 2);
                    const downloadLinkRoute = document.createElement('a');
                    downloadLinkRoute.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStringRoute);
                    downloadLinkRoute.download = `route_${pair.pairAddress}.json`;
                    downloadLinkRoute.textContent = 'R';
                    badge.appendChild(downloadLinkRoute);
                }
                // Post-process the jsonData.route to adjust swap fees
                if (jsonData && jsonData.route && jsonData.route.steps) {
                    jsonData.route.steps.forEach(step => {
                        if (step.swapFee !== "N/A" && step.swapFee !== "Error") {
                            // Multiply the swap fee by 100 (equivalent to moving the decimal two places to the right)
                            const adjustedFee = parseFloat(step.swapFee) * 100;
                            // Ensure fee is within valid range (0 to 100, representing 0% to 100%)
                            if (adjustedFee < 0) {
                                step.swapFee = 0;
                            } else {
                                // Format to a maximum of 1 decimal place
                                step.swapFee = adjustedFee.toFixed(1);
                            }
                        } else {
                            // Handle "N/A" or "Error" by setting to 20% (represented as 20.0)
                            step.swapFee = "20.0";
                        }
                    });
                }

                const headerDiv = card.querySelector('.card-header');
                if (headerDiv) {
                    headerDiv.appendChild(badge);
                } else {
                    card.appendChild(badge); // Fallback
                }
            }

            const headerDiv = document.createElement('div');
            headerDiv.classList.add('card-header');
            const title = document.createElement('div');
            title.classList.add('mdc-card__title');
            title.textContent = `${pair.baseToken.symbol}/${pair.quoteToken.symbol}`;
            headerDiv.appendChild(title);
            
            const subtitle = document.createElement('div');
            subtitle.classList.add('mdc-card__subtitle');
            subtitle.textContent = pair.pairAddress;
            headerDiv.appendChild(subtitle);
            
            card.appendChild(headerDiv);

            const bodyDiv = document.createElement('div');
            bodyDiv.classList.add('card-body');
            const priceNative = document.createElement('div');
            priceNative.textContent = `Native Price: ${pair.priceNative}`;
            bodyDiv.appendChild(priceNative);
            
            const priceUsd = document.createElement('div');
            // Display price with source indication
            if (pair.source === 'numia') {
                priceUsd.textContent = `Price (Numia): $${pair.priceUsd}`;
            } else {
                priceUsd.textContent = `Price (Dex): $${pair.priceUsd}`;
            }
            bodyDiv.appendChild(priceUsd);
            
            const liquidityDiv = document.createElement('div');
            liquidityDiv.textContent = `Liquidity: $${pair.liquidity.usd?.toLocaleString()}`;
            bodyDiv.appendChild(liquidityDiv);
            
            if (pair.baseToken.address !== token) {
                const calculatedPriceDiv = document.createElement('div');
                calculatedPriceDiv.textContent = `Calculated Price: $${currentPrice.toFixed(6)}`;
                bodyDiv.appendChild(calculatedPriceDiv);
            }
            
            const priceDifference = ((currentPrice - minPrice) / minPrice) * 100;
            const differenceDiv = document.createElement('div');
            differenceDiv.textContent = `Difference: ${priceDifference.toFixed(2)}%`;
            differenceDiv.classList.add('difference-line');
            bodyDiv.appendChild(differenceDiv);
            
            card.appendChild(bodyDiv);
            cardGrid.appendChild(card);
        });

        tokenGridContainer.appendChild(grid);
    } else {
        tokenGridContainer.textContent = `No pair data found for ${token}`;
    }
    mobileMenu.classList.remove('open');
}
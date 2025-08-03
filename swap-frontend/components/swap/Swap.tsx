// file: Swap.tsx

import BigNumber from 'bignumber.js';
import { Box, Divider, Spinner, useColorModeValue, Text } from '@interchain-ui/react';
import { Swap as ISwap } from '@/hooks';
import {
    Token,
    TokenList,
    SwapButton,
    SwapFromTo,
    SwapDetails,
    SwapSlippage,
    SwapInfoProps,
    SwapRouteStep,
} from '.';
import { SwapRoute, SwapRouteProps } from './SwapRoute';
// This is your statically imported data from route.json
import staticDataFromRouteFile from './route.json'; 

export type SwapProps = Omit<SwapPropsOriginal, 'steps' | 'from' | 'to'> & {
    routeDataOverride?: SwapRouteProps; 
};

type SwapPropsOriginal = {
    from?: Token;
    to?: Token;
    swap: ISwap;
    info: SwapInfoProps;
    steps: SwapRouteStep[];
    tokens: TokenList;
    amount?: string;
    loading?: boolean;
    swapping?: boolean;
    slippage?: number;
    buttonText?: string;
    buttonDisabled?: boolean;
    onFlip?: () => void;
    onToChange?: (token: Token) => void;
    onFromChange?: (token: Token) => void;
    onSwapButtonClick?: () => void;
    onAmountChange?: (amount: string) => void;
    onSlippageChange?: (tolerance: number) => void;
};

export function Swap({
    from = {} as Token,
    to = {} as Token,
    swap,
    info,
    steps = [], // Default for SwapDetails path
    tokens,
    amount = '0',
    loading = false,
    swapping = false,
    slippage,
    buttonText = 'Swap',
    buttonDisabled = false,
    onFlip = () => {},
    onToChange = () => {},
    onFromChange = () => {},
    onAmountChange = () => {},
    onSwapButtonClick = () => {},
    onSlippageChange = () => {},
    routeDataOverride, // Dynamic data prop from the parent
}: SwapProps) {
    const isDetailsExpandable = new BigNumber(amount).gt(0) && Boolean(info);

    let dataForSwapRoute: SwapRouteProps | undefined = undefined;

    // Check if staticDataFromRouteFile is "provided" and contains meaningful route data
    // Adjust this condition based on how you define an "empty" or "not provided" route.json
    const staticRouteIsConsideredProvided = 
        staticDataFromRouteFile && 
        staticDataFromRouteFile.steps && 
        staticDataFromRouteFile.steps.length > 0;

    if (staticRouteIsConsideredProvided) {
        // If route.json is "provided" (has content), use it.
        dataForSwapRoute = staticDataFromRouteFile as SwapRouteProps; 
        // console.log("Using static route.json data as primary source:", JSON.stringify(dataForSwapRoute, null, 2));
    } else {
        // If route.json is considered "not provided" or "empty", then use routeDataOverride.
        dataForSwapRoute = routeDataOverride;
        // console.log(routeDataOverride ? "Using dynamic routeDataOverride data as fallback." : "Static route.json empty, and no dynamic routeDataOverride provided.");
    }
    
    const shouldShowRoute = dataForSwapRoute && dataForSwapRoute.steps && dataForSwapRoute.steps.length > 0;

    return (
        <Box
            mx="auto"
            maxWidth="500px"
            minHeight="480px"
            overflow="hidden"
            position="relative"
        >
            <SwapFromTo
                to={to}
                from={from}
                swap={swap}
                amount={amount}
                tokens={tokens}
                onFlip={onFlip}
                onToChange={onToChange}
                onFromChange={onFromChange}
                onAmountChange={onAmountChange}
            />
            <SwapSlippage slippage={slippage} onChange={onSlippageChange} />
            <Divider />
            {shouldShowRoute && dataForSwapRoute ? (
                <SwapRoute {...dataForSwapRoute} /> 
            ) : (
                <SwapDetails
                    to={to}
                    from={from}
                    info={info}
                    steps={steps} 
                    expandable={isDetailsExpandable}
                />
            )}
            <SwapButton
                text={buttonText}
                disabled={buttonDisabled}
                onClick={onSwapButtonClick}
            />
            {/* Loading Spinner Box */}
            <Box
                position="absolute"
                top="$0"
                left="$0"
                right="$0"
                bottom="0"
                alignItems="center"
                justifyContent="center"
                borderRadius="$md"
                backgroundColor={useColorModeValue('$blackAlpha200', '$blackAlpha500')}
                display={loading || swapping ? 'flex' : 'none'}
            >
                <Spinner
                    size="$5xl"
                    color={useColorModeValue('$blackAlpha800', '$whiteAlpha900')}
                />
            </Box>
        </Box>
    );
}
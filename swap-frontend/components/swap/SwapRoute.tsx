// file: SwapRoute.tsx

import { Fragment } from 'react'; // Fragment might not be needed with new structure
import { Box, Text, Stack, useColorModeValue, Icon } from '@interchain-ui/react'; // Assuming Icon is available
import { Token } from '.';

// Define your fallback image path if not imported
const FALLBACK_TOKEN_LOGO = 'https://placehold.co/24x24/EEE/31343C'; 

// Use the Token type from your index.ts if it's globally accessible
// or redefine/import it here. For consistency, let's assume it's available.
// export type Token = { ... } // As defined in your index.ts

export type SwapRouteStep = {
  poolId: string;
  swapFee: string;
  fromToken: Token; // Token being offered in this step
  toToken: Token;   // Token being received in this step
  poolProvider?: string;
  error?: string;
};


export type SwapRouteProps = { // Renaming to avoid conflict if old one is still used elsewhere
  from: Token; // Overall start of the arbitrage
  to: Token;   // Overall end of the arbitrage
  steps?: SwapRouteStep[];
};

const DUMMY_TOKEN_DISPLAY: Token = {
  symbol: '---',
  logo: FALLBACK_TOKEN_LOGO, // Ensure this constant is available
  denom: 'unknown_denom',
  decimals: 0,
  error: 'Data missing', // Indicates it's a dummy
  // Add other non-optional fields from your Token type if any.
  // Optional fields from your Token type (asset, chain, price, amount, value, $value, balance) can be omitted.
};

export function SwapRoute({ from, to, steps = [] }: SwapRouteProps) {
  // Hooks called at the top level
  const textColor = useColorModeValue("$gray700", "$gray300");
  const mutedTextColor = useColorModeValue("$gray500", "$gray400");
  const errorColor = useColorModeValue("$red500", "$red400");
  const borderColorBase = useColorModeValue("$blackAlpha200", "$whiteAlpha200");
  const stepBoxBackgroundColor = useColorModeValue("$gray50", "$gray700");

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.currentTarget.src = FALLBACK_TOKEN_LOGO;
    e.currentTarget.onerror = null; // Prevent infinite loop if fallback itself fails
  };

  if (!steps || steps.length === 0) {
    return (
      <Box my="$6">
        {/* Assuming margin props on Text are handled via attributes */}
        <Text fontWeight="$semibold" fontSize="$sm" color="$textSecondary" attributes={{ marginBottom: "$4" }}>
          Route
        </Text>
        <Text fontSize="$sm" color={mutedTextColor}>Route information is currently unavailable.</Text>
      </Box>
    );
  }

  // Defensive check for overall 'from' and 'to' props
  const displayOverallFromToken = (from && from.symbol) ? from : DUMMY_TOKEN_DISPLAY;
  const displayOverallToToken = (to && to.symbol) ? to : DUMMY_TOKEN_DISPLAY;

  return (
    <Box my="$6">
      <Text fontWeight="$semibold" fontSize="$sm" color="$textSecondary" attributes={{ textAlign: 'center', marginBottom: "$4" }}>
        Arbitrage Route
      </Text>

      {/* Overall Start Token Display */}
      <Stack 
        direction="horizontal" 
        space="$2" 
        attributes={{ alignItems: 'center', justifyContent: 'center', marginBottom: "$4" }}
      >
        <Text fontSize="$xs" color={mutedTextColor}>Start with</Text>
        <img
          width="28"
          height="28"
          alt={displayOverallFromToken.symbol}
          src={displayOverallFromToken.logo}
          onError={handleImageError}
        />
        <Text fontSize="md" fontWeight="medium" color={textColor}>{displayOverallFromToken.symbol}</Text>
      </Stack>

      <Stack space="$5"> {/* Main vertical stack for steps */}
        {steps.map((step, index) => {
          const currentBorderColor = step.error ? errorColor : borderColorBase;

          // Defensive check for tokens within each step
          const displayFromToken = (step.fromToken && step.fromToken.symbol) ? step.fromToken : DUMMY_TOKEN_DISPLAY;
          const displayToToken = (step.toToken && step.toToken.symbol) ? step.toToken : DUMMY_TOKEN_DISPLAY;

          return (
            <Box
              key={step.poolId ? `${step.poolId}-${index}` : `step-${index}`}
              p="$4"
              borderRadius="$md"
              borderWidth="1px"
              borderStyle="solid"
              borderColor={currentBorderColor}
              backgroundColor={stepBoxBackgroundColor}
            >
              <Text fontWeight="medium" fontSize="sm" color={textColor} attributes={{ marginBottom: "$2" }}>
                Step {index + 1}: Swap on {step.poolProvider || `Pool ID: ${step.poolId}`}
              </Text>

              <Stack
                direction="horizontal"
                space="$3"
                attributes={{
                  alignItems: 'center',
                  justifyContent: 'space-around',
                  marginBottom: "$2"
                }}
              >
                {/* From Token for this step */}
                <Stack direction="vertical" space="$1" attributes={{ alignItems: 'center' }}>
                  <img
                    width="24"
                    height="24"
                    alt={displayFromToken.symbol}
                    src={displayFromToken.logo}
                    onError={handleImageError}
                  />
                  <Text fontSize="xs" color={displayFromToken.error ? errorColor : mutedTextColor} attributes={{ textAlign: 'center' }}>
                    {displayFromToken.symbol}
                  </Text>
                </Stack>

                <Icon name="arrowRightLine" size="lg" color={mutedTextColor} />

                {/* To Token for this step */}
                <Stack direction="vertical" space="$1" attributes={{ alignItems: 'center' }}>
                  <img
                    width="24"
                    height="24"
                    alt={displayToToken.symbol}
                    src={displayToToken.logo}
                    onError={handleImageError}
                  />
                  <Text fontSize="xs" color={displayToToken.error ? errorColor : mutedTextColor} attributes={{ textAlign: 'center' }}>
                    {displayToToken.symbol}
                  </Text>
                </Stack>
              </Stack>

              <Text fontSize="xs" color={mutedTextColor} attributes={{ textAlign: 'center' }}>
                Swap Fee: {step.swapFee || 'N/A'}
              </Text>

              {step.error && (
                <Text fontSize="xs" color={errorColor} attributes={{ textAlign: 'center', fontWeight: 'medium', marginTop: "$1" }}>
                  Note: {step.error}
                </Text>
              )}
            </Box>
          );
        })}
      </Stack>

      {/* Overall End Token Display */}
      <Stack 
        direction="horizontal" 
        space="$2" 
        attributes={{ alignItems: 'center', justifyContent: 'center', marginTop: "$4" }}
      >
        <Icon name="arrowDownLine" size="lg" color={mutedTextColor}/>
        <img
          width="28"
          height="28"
          alt={displayOverallToToken.symbol}
          src={displayOverallToToken.logo}
          onError={handleImageError}
        />
        <Text fontSize="md" fontWeight="medium" color={textColor}>{displayOverallToToken.symbol}</Text>
        <Text fontSize="$xs" color={mutedTextColor}>End with (Repay Loan)</Text>
      </Stack>
    </Box>
  );
}

// Dashes component (if still part of this file)
export function Dashes() {
  const dashColor = useColorModeValue('#d9d9d9', '#718096');
  return (
    <Box
      px="$7"
      // If you are sure about the style object structure and @ts-ignore is intentional.
      // @ts-ignore 
      style={{
        flex: '1',
        height: '1px',
        background: `repeating-linear-gradient(90deg, ${dashColor} 0 4px, #0000 0 12px)`
      }}
    />
  );
}
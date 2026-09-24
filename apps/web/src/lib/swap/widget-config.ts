import type { WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";

export const swapWidgetConfig: WidgetConfig = {
  integrator: "aurel",
  providers: [EthereumProvider()],
  mode: "default",
  variant: "wide",
  appearance: "system",
  fromChain: 8453,
  toChain: 8453,
  fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  toToken: "0x4200000000000000000000000000000000000006",
  chains: { allow: SUPPORTED_CHAINS.map((chain) => chain.id) },
  defaultUI: { layout: "cards" },
  theme: {
    container: { width: "100%", border: "1px solid rgba(11, 23, 32, 0.12)", borderRadius: "8px" },
    colorSchemes: {
      light: { palette: { primary: { main: "#123524" }, background: { default: "#faf9f6", paper: "#ffffff" } } },
      dark: { palette: { primary: { main: "#72ba91" }, background: { default: "#101d19", paper: "#182923" } } }
    },
    typography: { fontFamily: "Satoshi, Arial, sans-serif" }
  }
};

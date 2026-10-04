import { assetsFor, BASE_CHAIN_ID, registeredAsset } from "@/lib/assets/registry";
import type { Holding } from "./read";

const BASE_USDC_ID = assetsFor("swap", BASE_CHAIN_ID).find((item) => item.symbol === "USDC")!.id;
const swapLink = (from: string, to: string) => `/app/swap?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

type HoldingAction = { label: string; href: string; primary?: boolean };

/**
 * What can be done with a holding, in the words of what happens. Earn positions open their own card on Earn. Cash adds,
 * sends, and swaps. Everything else is bought with, or sold for, USDC, so Swap opens already set up for it.
 */
export function holdingActions(holding: Pick<Holding, "id" | "group" | "symbol">): HoldingAction[] {
  if (holding.group === "earn") {
    const earn = (action: "withdraw" | "deposit") => `/app/earn?position=${encodeURIComponent(holding.id)}&action=${action}`;
    // Aave WETH takes no new deposits; what's there can only be withdrawn.
    const withdrawOnly = holding.id.startsWith("aave:") && holding.symbol === "WETH";
    return [{ label: "Withdraw", href: earn("withdraw"), primary: true }, ...(withdrawOnly ? [] : [{ label: "Deposit", href: earn("deposit") }])];
  }
  const asset = registeredAsset(holding.id);
  if (!asset) return [];
  const sends = asset.uses.includes("send");
  const swaps = asset.uses.includes("swap");
  if (holding.group === "cash") return [
    ...(sends ? [{ label: "Send", href: `/app/send?asset=${encodeURIComponent(asset.symbol)}` }] : []),
    ...(asset.uses.includes("deposit") ? [{ label: "Add money", href: "/app/deposit#receive" }] : []),
    ...(swaps ? [{ label: "Swap", href: swapLink(asset.id, asset.id === BASE_USDC_ID ? `${BASE_CHAIN_ID}:native` : BASE_USDC_ID) }] : [])
  ].map((action, index) => ({ ...action, primary: index === 0 }));
  return [
    ...(swaps ? [{ label: "Buy", href: swapLink(BASE_USDC_ID, asset.id) }, { label: "Sell", href: swapLink(asset.id, BASE_USDC_ID) }] : []),
    ...(sends ? [{ label: "Send", href: `/app/send?asset=${encodeURIComponent(asset.symbol)}` }] : [])
  ].map((action, index) => ({ ...action, primary: index === 0 }));
}

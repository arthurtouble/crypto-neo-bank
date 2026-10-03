export const customerSections = [
  "deposit", "send", "swap", "earn", "perps", "predictions", "cards",
  "transactions", "insights", "settings", "support"
] as const;

export type CustomerSection = (typeof customerSections)[number];

export const navigation = [
  { group: "Home", items: [
    { label: "Overview", href: "/app" },
    { label: "Deposit", href: "/app/deposit" },
    { label: "Send", href: "/app/send" },
    { label: "Swap", href: "/app/swap" }
  ] },
  { group: "Grow", items: [
    { label: "Earn", href: "/app/earn" },
    { label: "Perps", href: "/app/perps" },
    { label: "Predictions", href: "/app/predictions" }
  ] },
  { group: "Everyday", items: [
    { label: "Cards", href: "/app/cards" },
    { label: "Transactions", href: "/app/transactions" },
    { label: "Insights", href: "/app/insights" }
  ] },
  { group: "Account", items: [
    { label: "Settings", href: "/app/settings" },
    { label: "Support", href: "/app/support" }
  ] }
] as const;

const legacy: Record<string, string> = {
  transfers: "/app/deposit", assets: "/app", exchange: "/app/swap",
  invest: "/app/swap", card: "/app/cards", activity: "/app/transactions",
  goals: "/app", benefits: "/app/cards", rewards: "/app/cards", concierge: "/app/support",
  security: "/app/settings", status: "/app/support", borrow: "/app/earn",
  // Markets was one section with two tabs until 3 October 2026; its pages redirect themselves (app/app/markets).
  markets: "/app/perps"
};

export function legacySectionDestination(section: string): string | null {
  return legacy[section] ?? null;
}

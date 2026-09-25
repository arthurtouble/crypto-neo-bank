export const customerSections = [
  "deposit", "send", "swap", "earn", "invest", "cards",
  "rewards", "transactions", "insights", "settings", "support"
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
    { label: "Invest", href: "/app/invest" }
  ] },
  { group: "Everyday", items: [
    { label: "Cards", href: "/app/cards" },
    { label: "Rewards", href: "/app/rewards" },
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
  markets: "/app/invest", card: "/app/cards", activity: "/app/transactions",
  goals: "/app", benefits: "/app/rewards", concierge: "/app/support",
  security: "/app/settings", status: "/app/support", borrow: "/app/earn"
};

export function legacySectionDestination(section: string): string | null {
  return legacy[section] ?? null;
}

export const dashboard = {
  clientName: "Alex Morgan",
  relationshipValue: 184290.42,
  spendable: 28450.18,
  productive: 112840.24,
  external: 43000,
  borrowed: 0,
  netYield: 4.72,
  monthlyIncome: 486.22,
  membership: "Black",
  relationshipScore: 74,
  allocation: [
    { label: "Liquid reserve", value: 28450.18, pct: 15.4, color: "#2F5E75" },
    { label: "Productive stablecoins", value: 112840.24, pct: 61.2, color: "#2E6254" },
    { label: "Connected assets", value: 43000, pct: 23.4, color: "#9B7847" }
  ]
};

export const activity = [
  { title: "USDC allocation", detail: "Aave V3 · Base", amount: "+$20,000.00", status: "Settled", date: "Today, 09:42", tone: "positive" },
  { title: "Card authorization", detail: "TAP Air Portugal", amount: "−$1,284.70", status: "Pending", date: "Yesterday, 18:16", tone: "neutral" },
  { title: "Bank transfer", detail: "USD virtual account", amount: "+$12,500.00", status: "Settled", date: "18 Sep, 14:20", tone: "positive" },
  { title: "USDC received", detail: "0x71a4…9c20", amount: "+$4,200.00", status: "Settled", date: "17 Sep, 11:08", tone: "positive" }
];

export const strategies = [
  {
    name: "USD Core Reserve",
    protocol: "Aave V3 · Base",
    apy: "4.72%",
    liquidity: "Usually instant",
    risk: "Low–moderate",
    description: "A transparent USDC lending position with daily liquidity and no lockup.",
    exposure: ["USDC issuer", "Aave smart contracts", "Base network"]
  },
  {
    name: "Treasury Plus",
    protocol: "Demonstration strategy",
    apy: "5.18%",
    liquidity: "1–2 business days",
    risk: "Moderate",
    description: "A diversified demonstration allocation. Not enabled for deposits.",
    exposure: ["Tokenized treasuries", "Vault curator", "Settlement liquidity"]
  }
];

export const riskItems = [
  { title: "Account protection", value: "Strong", note: "Passkey and withdrawal allowlist enabled", state: "good" },
  { title: "Protocol concentration", value: "61%", note: "Above the recommended 50% threshold", state: "warn" },
  { title: "Immediate liquidity", value: "$28,450", note: "2.8 months of your selected reserve target", state: "good" },
  { title: "Stablecoin exposure", value: "USDC 77%", note: "Consider a second eligible reserve asset", state: "neutral" }
];

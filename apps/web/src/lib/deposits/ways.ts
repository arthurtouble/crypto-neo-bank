/**
 * The ways to add money, in the order Add money shows them. Overview's empty account lists the same ways, so both read
 * this list and say the same thing. Each id is also the anchor that opens it directly (`/app/deposit#bank`).
 */
export const ADD_MONEY_WAYS = [
  { id: "receive", label: "Receive", detail: "From an exchange or another wallet" },
  { id: "wallet", label: "From a wallet", detail: "Like MetaMask, on Base or another network" },
  { id: "card", label: "Card", detail: "Buy USDC with a debit or credit card" },
  { id: "bank", label: "Bank", detail: "US bank transfer" }
] as const;

export type AddMoneyWay = (typeof ADD_MONEY_WAYS)[number]["id"];

export const addMoneyHref = (way: AddMoneyWay) => `/app/deposit#${way}`;

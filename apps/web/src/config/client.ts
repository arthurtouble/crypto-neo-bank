// Privy app IDs are public identifiers. Keep the production identifier as a
// fallback because vinext inlines NEXT_PUBLIC_* variables at build time, while
// still allowing preview and local builds to override it.
export const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmub5evr4013l0cjs0w5dijlb";

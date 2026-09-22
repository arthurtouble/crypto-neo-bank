export type AssetBalance = {
  chainId: number;
  walletAddress: string;
  balance: bigint;
};

export function selectAutomaticSource(
  balances: AssetBalance[],
  requiredAmount: bigint,
  destinationChainId: number
) {
  return balances
    .filter((item) => item.chainId !== destinationChainId && item.balance >= requiredAmount)
    .sort((left, right) => {
      if (left.balance !== right.balance) return left.balance > right.balance ? -1 : 1;
      if (left.chainId !== right.chainId) return left.chainId - right.chainId;
      return left.walletAddress.localeCompare(right.walletAddress);
    })[0] ?? null;
}

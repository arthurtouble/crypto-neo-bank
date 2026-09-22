export type AssetBalance = {
  chainId: number;
  balance: bigint;
};

export function selectAutomaticSource(
  balances: AssetBalance[],
  requiredAmount: bigint,
  destinationChainId: number
) {
  return balances
    .filter((item) => item.chainId !== destinationChainId && item.balance >= requiredAmount)
    .sort((left, right) => left.balance === right.balance ? left.chainId - right.chainId : left.balance > right.balance ? -1 : 1)[0] ?? null;
}

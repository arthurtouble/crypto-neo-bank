export type AlertDirection = "above" | "below";
export type AlertStatus = "active" | "paused" | "cancelled";

export function validAlertThreshold(value: string): boolean {
  return /^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/.test(value) && /[1-9]/.test(value);
}

export function alertRuleLabel(direction: AlertDirection, threshold: string): string {
  const [whole, fraction] = threshold.split(".");
  const price = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`}`;
  return `ETH ${direction} $${price}`;
}

export function alertStateLabel(status: AlertStatus): string {
  return status === "active" ? "Saved · Not monitoring" : status === "paused" ? "Paused" : "Cancelled";
}

export function alertListState(loading: boolean, loaded: boolean, count: number): "loading" | "unavailable" | "empty" | "populated" {
  if (loading) return "loading";
  if (!loaded) return "unavailable";
  return count === 0 ? "empty" : "populated";
}

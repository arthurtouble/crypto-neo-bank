import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href={compact ? "/app" : "/"} aria-label="Aura home">
      <span className="brandMark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brandWord">AURA</span>
    </Link>
  );
}

/** The redesign's placeholder wordmark (a ring with an accent dot), until the final brand is designed. */
export function AppBrand() {
  return (
    <Link className="appBrand" href="/app" aria-label="Aura home">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle className="appBrandDot" cx="15.5" cy="9" r="2.2" /></svg>
      <span>aura</span>
    </Link>
  );
}

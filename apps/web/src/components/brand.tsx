import Link from "next/link";

/** The redesign's placeholder wordmark (a ring with an accent dot), until the final brand is designed. */
export function AppBrand({ href = "/app" }: { href?: string }) {
  return (
    <Link className="appBrand" href={href} aria-label="Aura home">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle className="appBrandDot" cx="15.5" cy="9" r="2.2" /></svg>
      <span>aura</span>
    </Link>
  );
}

import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href={compact ? "/app" : "/"} aria-label="Aura home">
      <span className="brandMark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brandWord">AURA</span>
    </Link>
  );
}

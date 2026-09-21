import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href={compact ? "/app" : "/"} aria-label="Aurel home">
      <span className="brandMark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brandWord">AUREL</span>
      {!compact && <span className="brandDescriptor">Private digital wealth</span>}
    </Link>
  );
}

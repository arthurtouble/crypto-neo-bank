/**
 * The subset of D1 these adapters use. Declared structurally so the package
 * works in both Workers (D1Database) and tests (node:sqlite shims) without
 * depending on Cloudflare type packages.
 */
export type RunResult = { meta: { changes?: number } };
export interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<RunResult>;
}
export interface ProjectionDatabase {
  prepare(query: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<RunResult[]>;
}

/** Projections only land for customers Aura already knows; unknown subjects are ignored, not retried. */
export async function subjectExists(db: ProjectionDatabase, subjectReference: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 AS found FROM subject_profiles WHERE subject_reference = ?").bind(subjectReference).first());
}

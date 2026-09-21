export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) { super("Too many requests. Try again shortly."); this.name = "RateLimitError"; }
}

export async function enforceRateLimit(db: D1Database, input: { namespace: string; subject: string; limit: number; windowSeconds: number; now?: number }) {
  const now = input.now ?? Date.now();
  const resetAt = now + input.windowSeconds * 1000;
  const key = `${input.namespace}:${input.subject}`;
  const row = await db.prepare(`INSERT INTO rate_limit_windows (bucket_key, hits, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      hits = CASE WHEN rate_limit_windows.reset_at <= ? THEN 1 ELSE rate_limit_windows.hits + 1 END,
      reset_at = CASE WHEN rate_limit_windows.reset_at <= ? THEN excluded.reset_at ELSE rate_limit_windows.reset_at END
    RETURNING hits, reset_at`).bind(key, resetAt, now, now).first<{ hits: number; reset_at: number }>();
  if (!row) throw new Error("Rate-limit state was unavailable.");
  if (row.hits > input.limit) throw new RateLimitError(Math.max(1, Math.ceil((row.reset_at - now) / 1000)));
  return { remaining: Math.max(0, input.limit - row.hits), resetAt: row.reset_at };
}

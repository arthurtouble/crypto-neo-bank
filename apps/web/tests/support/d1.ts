import type { DatabaseSync } from "node:sqlite";

type Value = string | number | bigint | null;
type Statement = ReturnType<typeof statement>;

function statement(db: DatabaseSync, sql: string, values: Value[] = []) {
  const reads = /^\s*(SELECT|WITH)\b/i.test(sql);
  return {
    sql, reads,
    bind: (...args: unknown[]) => statement(db, sql, args as Value[]),
    async first<T>() { return (db.prepare(sql).get(...values) ?? null) as T | null; },
    async all<T>() { return { results: db.prepare(sql).all(...values) as T[], success: true, meta: { changes: 0 } }; },
    async run() { const result = db.prepare(sql).run(...values); return { results: [], success: true, meta: { changes: Number(result.changes) } }; }
  };
}

/** A D1Database backed by node:sqlite, with batch() as one transaction like D1. */
export function d1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(item.reads ? await item.all() : await item.run());
        db.exec("COMMIT");
        return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
  } as unknown as D1Database;
}

/**
 * D1 in memory for the tests, over Node's own SQLite. D1 is SQLite too, so
 * the Worker's statements run for real: the compare and swap, the counters
 * and the schema are checked, not imitated. Only what the Worker uses is
 * here, and a batch is one transaction, as in D1.
 */
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result, D1Value } from '../worker';

export interface TestD1 extends D1Database {
  /** The database underneath, for checking what was stored. */
  readonly sqlite: DatabaseSync;
  /** The statements of every call, in order: one for a single statement, all of a batch's. */
  readonly calls: string[][];
  /** While true, every call fails, as D1 does when it cannot be reached. */
  down: boolean;
}

interface Statement extends D1PreparedStatement {
  readonly sql: string;
  readonly values: D1Value[];
}

const READS = /^\s*(SELECT|WITH)\b/i;

export function testD1(): TestD1 {
  const sqlite = new DatabaseSync(':memory:');
  const calls: string[][] = [];

  function begin(sqls: string[]): void {
    calls.push(sqls);
    // The message quotes the statements, as D1's can, so a test can see it goes nowhere.
    if (d1.down) throw new Error(`D1 is unavailable: ${sqls.join('; ')}`);
  }

  function execute(sql: string, values: D1Value[]): D1Result {
    const prepared = sqlite.prepare(sql);
    if (READS.test(sql)) {
      // D1 gives plain objects, where SQLite's rows have no prototype.
      return { results: prepared.all(...values).map((row) => ({ ...row })), meta: { changes: 0 } };
    }
    return { results: [], meta: { changes: Number(prepared.run(...values).changes) } };
  }

  function statement(sql: string, values: D1Value[]): Statement {
    return {
      sql,
      values,
      bind: (...bound) => statement(sql, bound),
      async first<T>() {
        begin([sql]);
        const row = sqlite.prepare(sql).get(...values);
        return row ? ({ ...row } as unknown as T) : null;
      },
      async all<T>() {
        begin([sql]);
        return execute(sql, values) as D1Result<T>;
      },
      async run() {
        begin([sql]);
        return execute(sql, values);
      },
    };
  }

  const d1: TestD1 = {
    sqlite,
    calls,
    down: false,
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      const list = statements as Statement[];
      begin(list.map((each) => each.sql));
      sqlite.exec('BEGIN');
      try {
        const results = list.map((each) => execute(each.sql, each.values));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return d1;
}

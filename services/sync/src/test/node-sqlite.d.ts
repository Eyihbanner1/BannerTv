// The part of Node's node:sqlite that the test D1 uses. This package type-checks Worker
// code, so its tsconfig loads no Node types, and the tests declare what they need.
declare module 'node:sqlite' {
  type SQLValue = string | number | bigint | null | Uint8Array;

  export interface StatementSync {
    all(...values: SQLValue[]): Record<string, SQLValue>[];
    get(...values: SQLValue[]): Record<string, SQLValue> | undefined;
    run(...values: SQLValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

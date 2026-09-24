// Minimal ambient declarations for `node:sqlite` (Node 22.5+, stable in 24).
//
// The repo pins @types/node@20, which predates this module. Declaring only the
// surface the worker domain uses is deliberate: bumping @types/node repo-wide is
// a much larger change than this domain warrants, and a full re-declaration
// would drift silently against the runtime implementation.
declare module "node:sqlite" {
  type SQLInputValue = null | number | bigint | string | Uint8Array;

  export interface StatementSync {
    run(...params: SQLInputValue[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: SQLInputValue[]): unknown;
    all(...params: SQLInputValue[]): unknown[];
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

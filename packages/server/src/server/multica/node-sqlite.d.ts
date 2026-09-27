/**
 * Ambient declaration for the subset of node:sqlite the multica replica uses.
 *
 * @types/node@20 predates the module's typings; Node 24 ships it natively.
 * Declared to the surface actually consumed — exec/prepare with typed rows —
 * so anything richer fails loudly here instead of passing silently.
 */
declare module "node:sqlite" {
  interface StatementResult {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    all(...params: unknown[]): any[];
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    get(...params: unknown[]): any;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }

  class DatabaseSync {
    constructor(path: string, options?: { open?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementResult;
    close(): void;
  }
}

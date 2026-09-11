/** Provider resolver shim (voice retired, issue 025 C8). */
export type Resolvable<T> = T | (() => T);

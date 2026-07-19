/** The only supported graphical runtime is browser Web. */
export const isWeb: boolean = true;

/** Compatibility gate for shared upstream branches; always false in BySpace. */
export const isNative: boolean = false;

/** Development build/runtime — true in Metro dev bundles, false in production. */
export const isDev = Boolean((globalThis as { __DEV__?: boolean }).__DEV__);

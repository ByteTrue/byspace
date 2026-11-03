/** Development build: true under the Vite dev server, false in production builds and in tests. */
export const isDev = Boolean((globalThis as { __DEV__?: boolean }).__DEV__);

// Transitional stand-in for `expo-asset`: on the web a bundled asset already is its URL, either a
// string or the `{ uri }` vite.config.ts makes of a Metro-style require. Deleted at the cutover.
export const Asset = {
  fromModule(module: unknown): { uri: string | null } {
    if (typeof module === "string") return { uri: module };
    const uri = typeof module === "object" && module !== null ? Reflect.get(module, "uri") : null;
    return { uri: typeof uri === "string" ? uri : null };
  },
};

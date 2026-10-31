// Transitional stand-in for `expo-asset`: on the web a bundled asset module already is its URL.
// Deleted at the cutover.
export const Asset = {
  fromModule(module: unknown): { uri: string | null } {
    if (typeof module === "string") return { uri: module };
    const url =
      typeof module === "object" && module !== null ? Reflect.get(module, "default") : null;
    return { uri: typeof url === "string" ? url : null };
  },
};

// localStorage behind the promise API the app's stores and caches persist through. It is what
// React Native's AsyncStorage was on the web, which they were written against.
const localStorageAsync = {
  getItem: async (key: string): Promise<string | null> => window.localStorage.getItem(key),
  setItem: async (key: string, value: string): Promise<void> => {
    window.localStorage.setItem(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    window.localStorage.removeItem(key);
  },
  getAllKeys: async (): Promise<string[]> => Object.keys(window.localStorage),
  multiGet: async (keys: readonly string[]): Promise<Array<[string, string | null]>> =>
    keys.map((key) => [key, window.localStorage.getItem(key)]),
  multiRemove: async (keys: readonly string[]): Promise<void> => {
    for (const key of keys) window.localStorage.removeItem(key);
  },
};

export default localStorageAsync;

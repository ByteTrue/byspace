// A react-native-reanimated SharedValue without the UI thread: a value you can set without a React
// render, with listeners. The modules ported from the Expo app (file-drop's drop listeners) take a
// SharedValue and only read and write `.value`; this gives them one.

/** react-native-reanimated's SharedValue interface, which createSharedFlag implements. */
export interface SharedValue<T> {
  value: T;
  get(): T;
  set(next: T | ((value: T) => T)): void;
  addListener(id: number, listener: (value: T) => void): void;
  removeListener(id: number): void;
  modify(modifier?: (value: T) => T, forceUpdate?: boolean): void;
}

export function createSharedFlag<T>(initial: T): SharedValue<T> {
  let current = initial;
  const listeners = new Map<number, (value: T) => void>();
  const write = (next: T) => {
    if (Object.is(next, current)) return;
    current = next;
    for (const listener of listeners.values()) listener(next);
  };
  return {
    get value() {
      return current;
    },
    set value(next: T) {
      write(next);
    },
    get: () => current,
    set: (next) => write(typeof next === "function" ? (next as (value: T) => T)(current) : next),
    addListener: (id, listener) => {
      listeners.set(id, listener);
    },
    removeListener: (id) => {
      listeners.delete(id);
    },
    modify: (modifier) => {
      if (modifier) write(modifier(current));
    },
  };
}

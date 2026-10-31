// A react-native-reanimated SharedValue without the UI thread: a value you can set without a React
// render, with listeners. Shared modules (file-drop's drop listeners) take SharedValue and only
// read and write `.value`; this gives them one on the web.
import type { SharedValue } from "react-native-reanimated";

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

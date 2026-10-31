// Stand-in for expo/dom. A "use dom" component is an ordinary component in a browser: on the web
// Expo's useDOMImperativeHandle is useImperativeHandle, and the `dom` prop configures the native
// webview, so it means nothing here. The types are Expo's.
import { useImperativeHandle, type DependencyList, type Ref } from "react";

export type JSONValue = boolean | number | string | null | JSONArray | JSONObject;
export interface JSONArray extends Array<JSONValue> {}
export interface JSONObject {
  [key: string]: JSONValue | undefined;
}

export interface DOMImperativeFactory {
  [key: string]: (...args: JSONValue[]) => void;
}

/** The native webview's props; ignored on the web. */
export type DOMProps = Record<string, unknown>;

export function useDOMImperativeHandle<T extends DOMImperativeFactory>(
  ref: Ref<T>,
  init: () => T,
  deps?: DependencyList,
): void {
  // The caller's deps, passed through as Expo does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, init, deps);
}

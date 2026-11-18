// App navigation over React Router's data router. Code calls `router.push("/h/...")` with the
// same URL strings the Expo app used, from components and from plain modules alike, so the router
// is a module-level object bound once in main.tsx rather than a hook.
import { createContext, useContext } from "react";
import { Navigate, useLocation, useParams, type Location } from "react-router";

interface HrefObject {
  pathname: string;
  params?: Record<string, string | number | undefined>;
}
export type Href = string | HrefObject;

interface NavigationTarget {
  navigate(to: string | number, options?: { replace?: boolean }): unknown;
}

let target: NavigationTarget | null = null;

/** Called once in main.tsx with the data router, before the first render. */
export function bindRouter(navigationTarget: NavigationTarget): void {
  target = navigationTarget;
}

function requireTarget(): NavigationTarget {
  if (!target) throw new Error("router used before bindRouter()");
  return target;
}

/** Fills `[param]` segments from `params`; leftover params become the query. */
export function hrefToPath(href: Href): string {
  if (typeof href === "string") return href;
  let path = href.pathname;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(href.params ?? {})) {
    if (value === undefined) continue;
    const token = `[${key}]`;
    if (path.includes(token)) path = path.replace(token, encodeURIComponent(String(value)));
    else query.set(key, String(value));
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export const router = {
  push(href: Href) {
    void requireTarget().navigate(hrefToPath(href));
  },
  navigate(href: Href) {
    void requireTarget().navigate(hrefToPath(href));
  },
  replace(href: Href) {
    void requireTarget().navigate(hrefToPath(href), { replace: true });
  },
  dismissTo(href: Href) {
    void requireTarget().navigate(hrefToPath(href), { replace: true });
  },
  back() {
    void requireTarget().navigate(-1);
  },
  canGoBack(): boolean {
    // React Router keeps its history index in history.state.
    const state: unknown = window.history.state;
    const index = typeof state === "object" && state !== null ? Reflect.get(state, "idx") : 0;
    return typeof index === "number" && index > 0;
  },
};

export function useRouter() {
  return router;
}

// The location on screen. React Router hands the workspace kept mounted under a pushed screen its own
// location (~/app/workspace-layer.tsx); usePathname and useGlobalSearchParams report the screen on
// top there, so they read this one. useLocalSearchParams reports the route's own.
const GlobalLocationContext = createContext<Location | null>(null);
export const GlobalLocationProvider = GlobalLocationContext.Provider;

function useGlobalLocation(): Location {
  const local = useLocation();
  return useContext(GlobalLocationContext) ?? local;
}

export function usePathname(): string {
  return useGlobalLocation().pathname;
}

type SearchParams = Record<string, string | string[] | undefined>;

export function useLocalSearchParams<T extends SearchParams = SearchParams>(): T {
  const params = useParams();
  const { search } = useLocation();
  const merged: Record<string, string | undefined> = {};
  new URLSearchParams(search).forEach((value, key) => {
    merged[key] = value;
  });
  return { ...merged, ...params } as T;
}

export function useGlobalSearchParams<T extends SearchParams = SearchParams>(): T {
  const params = useParams();
  const { search } = useGlobalLocation();
  const merged: Record<string, string | undefined> = {};
  new URLSearchParams(search).forEach((value, key) => {
    merged[key] = value;
  });
  return { ...merged, ...params } as T;
}

export function Redirect({ href }: { href: Href }) {
  return <Navigate to={hrefToPath(href)} replace />;
}

// Transitional stand-in for `expo-router` while web/ imports modules from packages/app/src.
// Shared navigation code calls `router.push("/h/...")` with the same URL strings the Expo app
// uses; this forwards them to React Router. Deleted at the cutover.
import { Navigate, useLocation, useParams } from "react-router";

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
export function bindExpoRouter(navigationTarget: NavigationTarget): void {
  target = navigationTarget;
}

function requireTarget(): NavigationTarget {
  if (!target) throw new Error("expo-router shim used before bindExpoRouter()");
  return target;
}

/** Fills `[param]` segments the way expo-router does; leftover params become the query. */
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

export function usePathname(): string {
  return useLocation().pathname;
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

export const useGlobalSearchParams = useLocalSearchParams;

export function Redirect({ href }: { href: Href }) {
  return <Navigate to={hrefToPath(href)} replace />;
}

// @ts-nocheck
import { vi } from "vitest";
import React from "react";

const globalWithTestShims = globalThis as typeof globalThis & Record<string, unknown>;

globalWithTestShims.__DEV__ = false;

// JSDOM has no CSS media-query engine. Give libraries the browser API with no active
// preferences; responsive behavior is exercised in Chromium.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (media: string) =>
    Object.assign(new window.EventTarget(), {
      media,
      matches: false,
      onchange: null,
      addListener(listener: EventListener) {
        this.addEventListener("change", listener);
      },
      removeListener(listener: EventListener) {
        this.removeEventListener("change", listener);
      },
    });
}

if (typeof globalThis.self === "undefined") {
  globalWithTestShims.self = globalThis;
}

if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

if (typeof globalThis.cancelAnimationFrame !== "function") {
  globalThis.cancelAnimationFrame = (handle: number) => {
    clearTimeout(handle);
  };
}

// The router shim (src/shims/expo-router.tsx) drives React Router, which a unit test does not
// mount; navigation calls are recorded instead.
const RouterPassthrough = ({ children }: { children?: React.ReactNode }) => children;

vi.mock("expo-router", () => ({
  Redirect: () => null,
  Stack: Object.assign(RouterPassthrough, {
    Screen: () => null,
    Protected: RouterPassthrough,
  }),
  router: {
    back: vi.fn(),
    canGoBack: vi.fn(() => false),
    navigate: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    setParams: vi.fn(),
  },
  useGlobalSearchParams: vi.fn(() => ({})),
  useLocalSearchParams: vi.fn(() => ({})),
  usePathname: vi.fn(() => "/"),
  useRootNavigationState: vi.fn(() => ({ key: "root" })),
  useRouter: vi.fn(() => ({
    back: vi.fn(),
    canGoBack: vi.fn(() => false),
    navigate: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    setParams: vi.fn(),
  })),
}));

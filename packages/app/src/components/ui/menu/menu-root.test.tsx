/**
 * @vitest-environment jsdom
 */
import React, { createRef } from "react";
import { render } from "@testing-library/react";
import { Text, type View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MenuRoot, MenuTrigger } from "./menu-root";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({ color: "#000" }) }) },
  useUnistyles: () => ({ theme: {}, rt: { breakpoint: "md" } }),
  withUnistyles: (Component: React.ComponentType) => Component,
}));

beforeEach(() => vi.stubGlobal("React", React));

describe("MenuTrigger", () => {
  it("forwards its rendered trigger to callers", () => {
    const triggerRef = createRef<View>();

    render(
      <MenuRoot>
        <MenuTrigger ref={triggerRef} accessibilityLabel="Open menu">
          <Text>Open</Text>
        </MenuTrigger>
      </MenuRoot>,
    );

    expect(triggerRef.current).not.toBeNull();
  });
});

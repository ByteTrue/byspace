/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentControlTrigger } from "./control";

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

vi.mock("@/composer/agent-controls/layout-context", () => ({
  useComposerControlLayout: () => ({ glyphSize: 16 }),
}));

vi.mock("@/composer/agent-controls/glyph", () => ({
  ComposerToolbarGlyph: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/combobox-trigger", async () => {
  const react = await import("react");
  return {
    ComboboxTrigger: react.forwardRef<
      HTMLButtonElement,
      React.ButtonHTMLAttributes<HTMLButtonElement> & {
        accessibilityLabel?: string;
        onPress?: () => void;
      }
    >(function ComboboxTrigger(
      { accessibilityLabel, children, disabled, onFocus, onPointerEnter, onPress },
      ref,
    ) {
      return react.createElement(
        "button",
        {
          "aria-label": accessibilityLabel,
          type: "button",
          disabled,
          onClick: onPress,
          onFocus,
          onPointerEnter,
          ref,
        },
        children,
      );
    }),
  };
});

beforeEach(() => vi.stubGlobal("React", React));

function TestIcon() {
  return null;
}

describe("AgentControlTrigger", () => {
  it("forwards interaction handlers to the rendered trigger", () => {
    const onPointerEnter = vi.fn();
    const onFocus = vi.fn();
    const onPress = vi.fn();
    const view = render(
      <AgentControlTrigger
        icon={TestIcon}
        surface="toolbar"
        label="Mode"
        onPress={onPress}
        onPointerEnter={onPointerEnter}
        onFocus={onFocus}
        accessibilityLabel="Select mode"
      />,
    );
    const trigger = view.getByRole("button", { name: "Select mode" });

    fireEvent.pointerEnter(trigger);
    fireEvent.focus(trigger);

    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

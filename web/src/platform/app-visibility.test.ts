import { expect, test } from "vitest";
import { isAppActivelyVisible, isAppVisible } from "./app-visibility";

test("a visible page remains visible when another window has focus", () => {
  const input = {
    appState: "active",
    documentVisible: true,
    windowFocused: false,
  };

  expect(isAppVisible(input)).toBe(true);
  expect(isAppActivelyVisible(input)).toBe(false);
});

test("a hidden page is neither visible nor actively visible", () => {
  const input = {
    appState: "active",
    documentVisible: false,
    windowFocused: true,
  };

  expect(isAppVisible(input)).toBe(false);
  expect(isAppActivelyVisible(input)).toBe(false);
});

import { afterEach, describe, expect, it } from "vitest";
import { applyRootUiFont } from "./apply-root-font.web";

const STYLE_ID = "byspace-ui-font";
const CSS_VARIABLE = "--byspace-ui-font";
const ROOT_IDS = ["root", "overlay-root"] as const;
const createdRoots: HTMLElement[] = [];

afterEach(() => {
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.style.removeProperty(CSS_VARIABLE);
  for (const root of createdRoots.splice(0)) root.remove();
});

describe("applyRootUiFont", () => {
  it("applies the BySpace system font selector to the app and overlay roots", () => {
    const children = ROOT_IDS.map((id) => {
      const root = document.createElement("div");
      root.id = id;
      const child = document.createElement("span");
      root.appendChild(child);
      document.body.appendChild(root);
      createdRoots.push(root);
      return child;
    });

    applyRootUiFont("BySpaceSystemFont");

    expect(document.documentElement.style.getPropertyValue(CSS_VARIABLE)).toBe("BySpaceSystemFont");
    expect(document.getElementById(STYLE_ID)?.textContent).toBe(
      ":is(#root, #overlay-root) *:not([data-pmono]):not([data-pmono] *){font-family:var(--byspace-ui-font);}",
    );
    expect(children.map((child) => getComputedStyle(child).fontFamily)).toEqual([
      "BySpaceSystemFont",
      "BySpaceSystemFont",
    ]);
  });
});

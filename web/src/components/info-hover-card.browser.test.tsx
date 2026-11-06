import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { InfoHoverCard, InfoHoverCardContent, InfoHoverCardTrigger } from "./info-hover-card";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function hover(
  element: HTMLElement,
  type: "pointerover" | "pointerout",
  relatedTarget: EventTarget | null = null,
) {
  element.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerType: "mouse", relatedTarget }),
  );
  element.dispatchEvent(
    new PointerEvent(type === "pointerover" ? "pointerenter" : "pointerleave", {
      pointerType: "mouse",
      relatedTarget,
    }),
  );
}

describe("InfoHoverCard in the browser", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    await page.viewport(1000, 700);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    flushSync(() => {
      root.render(
        <InfoHoverCard>
          <InfoHoverCardTrigger>
            <button type="button" data-testid="trigger">
              Project path
            </button>
          </InfoHoverCardTrigger>
          <InfoHoverCardContent side="bottom">/workspace/project</InfoHoverCardContent>
        </InfoHoverCard>,
      );
    });
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    document.body.replaceChildren();
  });

  function trigger(): HTMLElement {
    const element = document.querySelector<HTMLElement>('[data-testid="trigger"]');
    expect(element).not.toBeNull();
    return element!;
  }

  function card(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-testid="info-hover-card"]');
  }

  it("does not open on focus, then stays open across the portal gap", async () => {
    trigger().focus();
    await nextFrame();
    expect(card()).toBeNull();

    await userEvent.hover(page.getByTestId("trigger"));
    expect(card()).not.toBeNull();

    hover(trigger(), "pointerout", card());
    hover(card()!, "pointerover", trigger());
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(card()).not.toBeNull();

    hover(card()!, "pointerout", document.body);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(card()).toBeNull();
  });

  it("keeps hover information out of compact layouts", async () => {
    await page.viewport(600, 700);
    await nextFrame();
    await userEvent.hover(page.getByTestId("trigger"));
    expect(card()).toBeNull();
  });
});

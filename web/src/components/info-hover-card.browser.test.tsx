import "../index.css";
import React, { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { InfoHoverCard, InfoHoverCardContent, InfoHoverCardTrigger } from "./info-hover-card";
import { ContextMenuTrigger } from "@/components/ui/context-menu";
import { ContextMenu } from "./ui/context-menu";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function CapturedDrag() {
  const [point, setPoint] = useState({ x: 200, y: 100 });
  return (
    <InfoHoverCard>
      <InfoHoverCardTrigger>
        <button
          type="button"
          data-testid="captured-trigger"
          style={{ position: "fixed", left: point.x, top: point.y, width: 140, height: 40 }}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => {
            if (event.buttons === 1) setPoint({ x: event.clientX, y: event.clientY });
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        >
          Drag me
        </button>
      </InfoHoverCardTrigger>
      <InfoHoverCardContent side="bottom" align="start" readOnly>
        A long path displayed near the drag target
      </InfoHoverCardContent>
    </InfoHoverCard>
  );
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

  function openCard(): HTMLElement | null {
    return card()?.dataset.state === "open" ? card() : null;
  }

  it("does not open on focus, then stays open across the portal gap", async () => {
    trigger().focus();
    await nextFrame();
    expect(openCard()).toBeNull();

    await userEvent.hover(page.getByTestId("trigger"));
    expect(openCard()).not.toBeNull();

    hover(trigger(), "pointerout", card());
    hover(card()!, "pointerover", trigger());
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(openCard()).not.toBeNull();

    hover(card()!, "pointerout", document.body);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(openCard()).toBeNull();
  });

  it("keeps read-only path cards out of neighboring row hit targets", async () => {
    flushSync(() => root.render(<CapturedDrag />));
    const dragTrigger = page.getByTestId("captured-trigger");
    await userEvent.hover(dragTrigger);
    const target = document.createElement("button");
    target.dataset.testid = "neighboring-row";
    Object.assign(target.style, {
      position: "fixed",
      left: "200px",
      top: "145px",
      width: "140px",
      height: "40px",
    });
    document.body.append(target);
    expect(card()).not.toBeNull();
    const wrapper = card()!.parentElement!;
    expect(getComputedStyle(wrapper).pointerEvents).toBe("none");
    expect(getComputedStyle(card()!).pointerEvents).toBe("none");
    expect(document.elementFromPoint(210, 155)).toBe(target);
    expect(card()).not.toHaveAttribute("inert");
    expect(getComputedStyle(card()!).userSelect).not.toBe("none");
    target.remove();
  });

  it("does not leave a pointer-captured drag's card over other rows", async () => {
    flushSync(() => root.render(<CapturedDrag />));
    const dragTrigger = page.getByTestId("captured-trigger");
    await userEvent.hover(dragTrigger);
    expect(card()).not.toBeNull();
    const bounds = dragTrigger.element().getBoundingClientRect();
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const session = cdp();
    await session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: start.x,
      y: start.y,
      button: "left",
      clickCount: 1,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: start.x,
      y: start.y + 30,
      button: "left",
    });
    expect(openCard()).toBeNull();
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: start.x,
      y: start.y + 30,
      button: "left",
      clickCount: 1,
    });
    expect(dragTrigger.element().getBoundingClientRect().y).toBe(start.y + 30);
  });

  it("closes on press without cancelling the trigger's press", async () => {
    let presses = 0;
    flushSync(() => {
      root.render(
        <InfoHoverCard>
          <InfoHoverCardTrigger>
            <button type="button" data-testid="trigger" onPointerDown={() => presses++}>
              Project path
            </button>
          </InfoHoverCardTrigger>
          <InfoHoverCardContent side="bottom">/workspace/project</InfoHoverCardContent>
        </InfoHoverCard>,
      );
    });

    await userEvent.hover(page.getByTestId("trigger"));
    expect(card()).not.toBeNull();
    trigger().dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
    await nextFrame();
    expect(openCard()).toBeNull();
    expect(presses).toBe(1);
  });

  it("closes when the trigger leaves the document", async () => {
    await userEvent.hover(page.getByTestId("trigger"));
    expect(card()).not.toBeNull();
    flushSync(() => root.render(null));
    expect(openCard()).toBeNull();
  });

  it("opens through a composed context-menu trigger", async () => {
    flushSync(() => {
      root.render(
        <ContextMenu>
          <InfoHoverCard>
            <InfoHoverCardTrigger>
              <ContextMenuTrigger>
                <button type="button" data-testid="trigger">
                  Workspace tab
                </button>
              </ContextMenuTrigger>
            </InfoHoverCardTrigger>
            <InfoHoverCardContent side="bottom">Tab information</InfoHoverCardContent>
          </InfoHoverCard>
        </ContextMenu>,
      );
    });
    await userEvent.hover(page.getByTestId("trigger"));
    expect(openCard()).not.toBeNull();
  });

  it("keeps hover information out of compact layouts", async () => {
    await page.viewport(600, 700);
    await nextFrame();
    await userEvent.hover(page.getByTestId("trigger"));
    expect(openCard()).toBeNull();
  });
});

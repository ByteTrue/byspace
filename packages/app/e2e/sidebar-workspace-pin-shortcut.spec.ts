import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { daemonWsRoutePattern } from "./helpers/daemon-port";
import { seedWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { waitForSidebarHydration } from "./helpers/workspace-ui";

// The pin shortcut used to be registered by the sidebar row itself, so it silently did nothing
// whenever the row was unmounted — a collapsed Pinned section being the common case. It now
// lives in a single always-mounted handler keyed on the active route selection.
const PIN_SHORTCUT = "ControlOrMeta+Shift+P";

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

function pinnedSection(page: Page) {
  return page.getByTestId("sidebar-pinned-section");
}

// Opens the workspace so it becomes the active route selection, which is what the shortcut acts on.
async function openWorkspace(page: Page, workspaceId: string) {
  const row = workspaceRow(page, workspaceId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
}

function readSessionMessage(
  message: string | Buffer,
): { type?: unknown; requestId?: unknown } | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    if (envelope.type !== "session" || typeof envelope.message !== "object") {
      return null;
    }
    return envelope.message as { type?: unknown; requestId?: unknown };
  } catch {
    return null;
  }
}

const PIN_REJECTION_MESSAGE = "Pin rejected by test.";

interface PinRpcGate {
  /** Pin requests the client has sent so far. */
  sentCount(): number;
}

// Proxies everything so the app boots against the real daemon, counting pin RPCs and optionally
// rejecting the first `rejectFirst` of them. The count asserts how many pins one keypress actually
// dispatched, which the rendered pin state cannot show — a toggle that fired twice lands back
// where it started.
async function installPinRpcGate(
  page: Page,
  options: { rejectFirst?: number } = {},
): Promise<PinRpcGate> {
  const rejectFirst = options.rejectFirst ?? 0;
  let sent = 0;

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const sessionMessage = readSessionMessage(message);
      if (
        sessionMessage?.type === "workspace.pin.set.request" &&
        typeof sessionMessage.requestId === "string"
      ) {
        sent += 1;
        if (sent <= rejectFirst) {
          ws.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "rpc_error",
                payload: {
                  requestId: sessionMessage.requestId,
                  requestType: "workspace.pin.set.request",
                  error: PIN_REJECTION_MESSAGE,
                  code: "transport",
                },
              },
            }),
          );
          return;
        }
      }

      try {
        server.send(message);
      } catch {
        // server socket already closed
      }
    });

    server.onMessage((message) => {
      try {
        ws.send(message);
      } catch {
        // client socket already closed
      }
    });
  });

  return { sentCount: () => sent };
}

test.describe("Pin workspace shortcut", () => {
  test("unpins the active workspace while the Pinned section is collapsed", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-unpin-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openWorkspace(page, workspace.workspaceId);

      await page.keyboard.press(PIN_SHORTCUT);
      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });

      await page.getByTestId("sidebar-pinned-section-header").click();
      await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(0, { timeout: 10_000 });

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await workspace.cleanup();
    }
  });

  test("sends exactly one pin RPC per press when the row is rendered and selected", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-expanded-" });

    try {
      const gate = await installPinRpcGate(page);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openWorkspace(page, workspace.workspaceId);

      await page.keyboard.press(PIN_SHORTCUT);
      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
      // Counting frames catches a press that produces zero or two RPCs — a misfiring in-flight
      // guard, or a second dispatch path. It cannot detect a duplicate handler registration:
      // `keyboardActionDispatcher.dispatch` returns at the first handler that returns true, so a
      // shadowed second handler is unobservable from outside by design.
      expect(gate.sentCount()).toBe(1);

      await page.keyboard.press(PIN_SHORTCUT);
      await expect(pinnedSection(page)).toHaveCount(0, { timeout: 10_000 });
      expect(gate.sentCount()).toBe(2);
      await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(1);
    } finally {
      await workspace.cleanup();
    }
  });

  test("shows an error toast when the host rejects the pin, and the next press succeeds", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-failure-" });

    try {
      const gate = await installPinRpcGate(page, { rejectFirst: 1 });

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openWorkspace(page, workspace.workspaceId);

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(page.getByTestId("app-toast-message")).toContainText(PIN_REJECTION_MESSAGE, {
        timeout: 10_000,
      });
      await expect(pinnedSection(page)).toHaveCount(0);
      await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(1);

      // The failure must leave the action usable: the in-flight guard has to release the key so a
      // retry is not swallowed. Without that release the workspace is unpinnable for the session.
      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
      expect(gate.sentCount()).toBe(2);
    } finally {
      await workspace.cleanup();
    }
  });
});

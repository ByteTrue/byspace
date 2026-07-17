import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  archiveWorkspaceFromDaemon,
  connectNewWorkspaceDaemonClient,
  openNewWorkspaceComposer,
  openProjectViaDaemon,
  openStartingRefPicker,
  selectWorkspaceIsolation,
} from "./helpers/new-workspace";
import { createTempGitRepo } from "./helpers/workspace";

type ForgeHarnessMode = "old-github" | "old-gitlab" | "new-gitlab";

async function installForgeWireHarness(page: Page, mode: ForgeHarnessMode): Promise<void> {
  await page.addInitScript((harnessMode) => {
    const NativeWebSocket = window.WebSocket;
    const nativeOnMessage = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, "onmessage");

    function transformMessage(event: MessageEvent): MessageEvent {
      if (typeof event.data !== "string") return event;
      const envelope = JSON.parse(event.data);
      const message = envelope.type === "session" ? envelope.message : envelope;
      if (message?.type !== "status" || message.payload?.status !== "server_info") return event;

      const features = { ...message.payload.features };
      if (harnessMode !== "new-gitlab") {
        delete features.forgeProviders;
        delete features.forgeSearch;
        delete features.forgeCheckDetails;
        delete features.checkoutForgeSetAutoMerge;
      }
      message.payload.features = features;
      return new MessageEvent("message", { data: JSON.stringify(envelope) });
    }

    class ForgeHarnessWebSocket extends NativeWebSocket {
      override send(data: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void {
        if (typeof data !== "string") {
          super.send(data);
          return;
        }
        const envelope = JSON.parse(data);
        const message = envelope.type === "session" ? envelope.message : envelope;
        const requestType = message?.type;
        if (requestType !== "forge.search.request" && requestType !== "github_search_request") {
          super.send(data);
          return;
        }

        const harnessWindow = window as typeof window & { __forgeRpcTypes?: string[] };
        harnessWindow.__forgeRpcTypes = [...(harnessWindow.__forgeRpcTypes ?? []), requestType];
        const isForge = requestType === "forge.search.request";
        const number = isForge ? 22 : 11;
        let response: unknown;
        if (isForge) {
          response = {
            type: "forge.search.response",
            payload: {
              items: [
                {
                  kind: "change_request",
                  forge: "gitlab",
                  number,
                  title: "Capability gate MR",
                  url: `https://gitlab.com/acme/repo/-/merge_requests/${number}`,
                  state: "opened",
                  body: null,
                  labels: [],
                  baseRefName: "main",
                  headRefName: "feature/forge",
                },
              ],
              authState: "authenticated",
              forge: "gitlab",
              error: null,
              requestId: message.requestId,
            },
          };
        } else {
          response = {
            type: "github_search_response",
            payload: {
              items: [
                {
                  kind: "pr",
                  number,
                  title: "Legacy GitHub PR",
                  url: `https://github.com/ByteTrue/byspace/pull/${number}`,
                  state: "OPEN",
                  body: null,
                  labels: [],
                  baseRefName: "main",
                  headRefName: "feature/github",
                },
              ],
              githubFeaturesEnabled: true,
              error: null,
              requestId: message.requestId,
            },
          };
        }
        queueMicrotask(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ type: "session", message: response }),
            }),
          );
        });
      }

      override addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (type !== "message") {
          super.addEventListener(type, listener, options);
          return;
        }
        const wrapped: EventListener = (event) => {
          const transformed = transformMessage(event as MessageEvent);
          if (typeof listener === "function") listener.call(this, transformed);
          else listener.handleEvent(transformed);
        };
        super.addEventListener(type, wrapped, options);
      }

      override set onmessage(listener: ((this: WebSocket, ev: MessageEvent) => unknown) | null) {
        nativeOnMessage?.set?.call(
          this,
          listener ? (event: MessageEvent) => listener.call(this, transformMessage(event)) : null,
        );
      }
    }

    window.WebSocket = ForgeHarnessWebSocket;
  }, mode);
}

async function openForgeProject(page: Page, mode: ForgeHarnessMode) {
  const isGitLab = mode !== "old-github";
  const repo = await createTempGitRepo(`forge-capability-${mode}-`, {
    withRemote: true,
    originUrl: isGitLab
      ? "https://gitlab.com/acme/repo.git"
      : "https://github.com/ByteTrue/byspace.git",
  });
  const client = await connectNewWorkspaceDaemonClient();
  const project = await openProjectViaDaemon(client, repo.path);
  await installForgeWireHarness(page, mode);
  await gotoAppShell(page);
  await openNewWorkspaceComposer(page, project);
  await selectWorkspaceIsolation(page, "worktree");
  await openStartingRefPicker(page);
  return { client, project, repo };
}

test.describe("forge capability gates", () => {
  test("an old host keeps the released GitHub search flow", async ({ page }) => {
    const context = await openForgeProject(page, "old-github");
    try {
      await expect(page.getByTestId("new-workspace-ref-picker-pr-11")).toContainText(
        "Legacy GitHub PR",
      );
      expect(
        await page.evaluate(
          () => (window as typeof window & { __forgeRpcTypes?: string[] }).__forgeRpcTypes,
        ),
      ).toEqual(["github_search_request"]);
    } finally {
      await archiveWorkspaceFromDaemon(context.client, context.project.workspaceDirectory);
      await context.client.close();
      await context.repo.cleanup();
    }
  });

  test("a non-GitHub project does not fall back when forge gates are missing", async ({ page }) => {
    const context = await openForgeProject(page, "old-gitlab");
    try {
      await expect(page.getByText("Update the host to use this.")).toBeVisible();
      expect(
        await page.evaluate(
          () => (window as typeof window & { __forgeRpcTypes?: string[] }).__forgeRpcTypes ?? [],
        ),
      ).toEqual([]);
    } finally {
      await archiveWorkspaceFromDaemon(context.client, context.project.workspaceDirectory);
      await context.client.close();
      await context.repo.cleanup();
    }
  });

  test("a capable host renders MR vocabulary and uses dotted forge search", async ({ page }) => {
    const context = await openForgeProject(page, "new-gitlab");
    try {
      const row = page.getByTestId("new-workspace-ref-picker-pr-22");
      await expect(row).toContainText("!22 Capability gate MR");
      await row.click();
      await expect(page.getByText("MR !22")).toBeVisible();
      expect(
        await page.evaluate(
          () => (window as typeof window & { __forgeRpcTypes?: string[] }).__forgeRpcTypes,
        ),
      ).toEqual(["forge.search.request"]);
    } finally {
      await archiveWorkspaceFromDaemon(context.client, context.project.workspaceDirectory);
      await context.client.close();
      await context.repo.cleanup();
    }
  });
});

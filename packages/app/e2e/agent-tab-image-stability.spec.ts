import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures";
import { createIdleAgent } from "./helpers/archive-tab";
import { openAgentRoute } from "./helpers/mock-agent";
import { seedWorkspace } from "./helpers/seed-client";

const SMALL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

async function waitForIdle(
  client: Awaited<ReturnType<typeof seedWorkspace>>["client"],
  id: string,
) {
  const result = await client.waitForFinish(id, 30_000);
  if (result.status !== "idle" || result.final?.lastError) {
    throw new Error(`Mock agent did not settle: ${result.final?.lastError ?? result.status}`);
  }
}

test("near-tail reload stays stable when an assistant image grows after load", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "assistant-image-near-tail-" });
  try {
    const fileName = "near-tail.png";
    const alt = "near-tail assistant image";
    await writeFile(path.join(workspace.repoPath, fileName), SMALL_PNG);
    const agent = await createIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Near-tail assistant image",
    });

    await workspace.client.sendAgentMessage(
      agent.id,
      `Emit settled assistant image Markdown: ![${alt}](${fileName})`,
    );
    await waitForIdle(workspace.client, agent.id);
    for (let index = 0; index < 5; index += 1) {
      await workspace.client.sendAgentMessage(
        agent.id,
        `image-history-turn-${index}: emit 1 coalesced agent stream updates`,
      );
      await waitForIdle(workspace.client, agent.id);
    }

    await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.id });
    const rendered = page.getByRole("img", { name: alt }).first();
    await expect(rendered).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () =>
        rendered.evaluate((element) => {
          const image =
            element instanceof HTMLImageElement ? element : element.querySelector("img");
          return image?.complete ? [image.naturalWidth, image.naturalHeight] : null;
        }),
      )
      .toEqual([1, 1]);

    await page.reload();
    await expect(rendered).toBeVisible({ timeout: 30_000 });
    const result = await rendered.evaluate(async (element) => {
      const image = element instanceof HTMLImageElement ? element : element.querySelector("img");
      const scroll = document.querySelector(
        '[data-testid="agent-chat-scroll"]:not([aria-hidden="true"])',
      );
      if (!image || !scroll) throw new Error("Expected assistant image and transcript scroll");
      const load = (src: string) =>
        new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error("Test image failed to load")), {
            once: true,
          });
          image.src = src;
        });

      await load(
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E",
      );
      scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight - 180);
      const before = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
      await load(
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3C/svg%3E",
      );
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return {
        before,
        after: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
        imageHeight: image.getBoundingClientRect().height,
      };
    });

    expect(result.before).toBeGreaterThan(150);
    expect(result.before).toBeLessThan(220);
    expect(result.imageHeight).toBeGreaterThan(300);
    expect(Math.abs(result.after - result.before)).toBeLessThanOrEqual(2);
  } finally {
    await workspace.cleanup();
  }
});

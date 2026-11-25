import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { requestWorkspaceDraftAgent } from "./create-agent-request";

vi.mock("@/attachments/encode-images", () => ({
  encodeImages: vi.fn(async () => [{ data: "aGVsbG8=", mimeType: "image/png" }]),
}));

describe("requestWorkspaceDraftAgent", () => {
  it("preserves an empty initial prompt when an image carries the content", async () => {
    const createAgent = vi.fn().mockResolvedValue({});
    const client = { createAgent } as unknown as DaemonClient;

    await requestWorkspaceDraftAgent(client, {
      workspaceId: "workspace-1",
      config: { provider: "pi", cwd: "/repo" },
      text: "",
      clientMessageId: "message-1",
      images: [
        {
          id: "image-1",
          mimeType: "image/png",
          storageType: "web-indexeddb",
          storageKey: "image-1",
          createdAt: 1,
        },
      ],
    });

    expect(createAgent).toHaveBeenCalledWith({
      config: { provider: "pi", cwd: "/repo" },
      workspaceId: "workspace-1",
      clientMessageId: "message-1",
      initialPrompt: "",
      images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
    });
  });
});

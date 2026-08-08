import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPersistedProjectRecord,
  type PersistedProjectRecord,
  type ProjectRegistry,
} from "../server/workspace-registry.js";
import { readProjectIcon, setProjectCustomIcon } from "./project-custom-icon.js";

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 2, 0, 0, 0,
]);
const cleanup: string[] = [];
afterEach(async () =>
  Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

async function target() {
  const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-icon-home-"));
  const rootPath = await mkdtemp(join(tmpdir(), "byspace-icon-project-"));
  cleanup.push(byspaceHome, rootPath);
  let record = createPersistedProjectRecord({
    projectId: "project-a",
    rootPath,
    kind: "git",
    displayName: "repo",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const projects = {
    get: async () => record,
    update: async (
      _id: string,
      update: (value: PersistedProjectRecord) => PersistedProjectRecord | null,
    ) => {
      const next = update(record);
      if (next) record = next;
      return next;
    },
  } as unknown as ProjectRegistry;
  return {
    save: (source: { type: "automatic" } | { type: "upload"; data: string }) =>
      setProjectCustomIcon({ byspaceHome, projectId: "project-a", source, projects }),
    read: () => readProjectIcon({ byspaceHome, project: record }),
  };
}

describe("project custom icon", () => {
  it("stores uploaded bytes and returns to automatic", async () => {
    const project = await target();
    await project.save({ type: "upload", data: PNG_1X1.toString("base64") });
    await expect(project.read()).resolves.toEqual({
      data: PNG_1X1.toString("base64"),
      mimeType: "image/png",
    });
    await project.save({ type: "automatic" });
    await expect(project.read()).resolves.toBeNull();
  });

  it("rejects invalid image bytes", async () => {
    const project = await target();
    await expect(
      project.save({ type: "upload", data: Buffer.from("nope").toString("base64") }),
    ).rejects.toThrow("Unsupported or invalid icon file");
  });
});

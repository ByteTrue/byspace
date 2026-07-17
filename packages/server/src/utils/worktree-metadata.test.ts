import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getBySpaceWorktreeMetadataPath,
  markBySpaceWorktreeFirstAgentBranchAutoNameAttempted,
  readBySpaceWorktreeMetadata,
  writeBySpaceWorktreeFirstAgentBranchAutoNameMetadata,
  writeBySpaceWorktreeMetadata,
  writeBySpaceWorktreeRuntimeMetadata,
} from "./worktree-metadata.js";

const roots: string[] = [];

async function createRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "byspace-metadata-"));
  roots.push(root);
  await mkdir(path.join(root, ".git"));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("BySpace worktree metadata", () => {
  it("round-trips trusted change-request identity", async () => {
    const root = await createRepo();
    writeBySpaceWorktreeMetadata(root, {
      baseRefName: "main",
      changeRequestLookupTarget: {
        forge: "gitlab",
        projectPath: "group/repo",
        headRef: "feature",
        headRepositoryOwner: "contributor",
        changeRequestNumber: 42,
      },
    });

    expect(readBySpaceWorktreeMetadata(root)?.changeRequestLookupTarget).toEqual({
      forge: "gitlab",
      projectPath: "group/repo",
      headRef: "feature",
      headRepositoryOwner: "contributor",
      changeRequestNumber: 42,
    });
  });

  it.each([1, 2] as const)("reads legacy version %s metadata without identity", async (version) => {
    const root = await createRepo();
    const metadataPath = getBySpaceWorktreeMetadataPath(root);
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(
      metadataPath,
      JSON.stringify({
        version,
        baseRefName: "main",
        changeRequestLookupTarget: { headRef: "legacy", changeRequestNumber: 4 },
      }),
    );

    expect(readBySpaceWorktreeMetadata(root)?.changeRequestLookupTarget).toEqual({
      headRef: "legacy",
      changeRequestNumber: 4,
    });
  });

  it("preserves identity through runtime and auto-name rewrites", async () => {
    const root = await createRepo();
    const target = { forge: "github", projectPath: "acme/repo", headRef: "feature" };
    writeBySpaceWorktreeMetadata(root, {
      baseRefName: "main",
      changeRequestLookupTarget: target,
    });
    writeBySpaceWorktreeRuntimeMetadata(root, { worktreePort: 4321 });
    writeBySpaceWorktreeFirstAgentBranchAutoNameMetadata(root, {
      placeholderBranchName: "placeholder",
    });
    markBySpaceWorktreeFirstAgentBranchAutoNameAttempted(root, {
      attemptedAt: "2026-07-17T00:00:00.000Z",
    });

    expect(readBySpaceWorktreeMetadata(root)?.changeRequestLookupTarget).toEqual(target);
  });
});

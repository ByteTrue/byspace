import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import {
  attemptFirstAgentBranchAutoName,
  renameWorkspaceBranch,
} from "./byspace-worktree-service.js";
import {
  writeBySpaceWorktreeFirstAgentBranchAutoNameMetadata,
  writeBySpaceWorktreeMetadata,
} from "../utils/worktree-metadata.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

test("renames an unpublished BySpace-generated worktree branch", async () => {
  const { byspaceHome, worktree } = createManagedWorktree("quiet-otter");
  const nestedCwd = path.join(worktree, "nested");
  mkdirSync(nestedCwd);

  await expect(
    renameWorkspaceBranch({
      cwd: nestedCwd,
      newBranchName: "focused-rename",
      checkoutContext: { byspaceHome },
    }),
  ).resolves.toEqual({
    previousBranch: "quiet-otter",
    currentBranch: "focused-rename",
  });
  expect(git(worktree, "branch", "--show-current")).toBe("focused-rename");
});

test("renames the provisional branch produced by initial auto-naming", async () => {
  const { byspaceHome, worktree } = createManagedWorktree("quiet-otter");
  await attemptFirstAgentBranchAutoName({
    cwd: worktree,
    firstAgentContext: { prompt: "Build focused workspace rename" },
    generateBranchNameFromContext: async () => "initial-prompt-name",
    checkoutContext: { byspaceHome },
  });

  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "converged-workspace-name",
      checkoutContext: { byspaceHome },
    }),
  ).resolves.toEqual({
    previousBranch: "initial-prompt-name",
    currentBranch: "converged-workspace-name",
  });
});

test("allows a later agent refinement of an auto-named branch", async () => {
  const { byspaceHome, worktree } = createManagedWorktree("quiet-otter");
  await attemptFirstAgentBranchAutoName({
    cwd: worktree,
    firstAgentContext: { prompt: "Build focused workspace rename" },
    generateBranchNameFromContext: async () => "initial-prompt-name",
    checkoutContext: { byspaceHome },
  });

  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "converged-workspace-name",
      checkoutContext: { byspaceHome },
    }),
  ).resolves.toEqual({
    previousBranch: "initial-prompt-name",
    currentBranch: "converged-workspace-name",
  });
  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "final-workspace-name",
      checkoutContext: { byspaceHome },
    }),
  ).resolves.toEqual({
    previousBranch: "converged-workspace-name",
    currentBranch: "final-workspace-name",
  });
});

test("rejects a branch that was renamed outside BySpace", async () => {
  const { byspaceHome, worktree } = createManagedWorktree("quiet-otter");
  git(worktree, "branch", "-m", "manually-renamed");

  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "focused-rename",
      checkoutContext: { byspaceHome },
    }),
  ).rejects.toThrow("current BySpace-generated worktree branch");
});

test("rejects a published branch even without an upstream", async () => {
  const { root, byspaceHome, repo, worktree } = createManagedWorktree("quiet-otter");
  const remote = path.join(root, "remote.git");
  git(root, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(worktree, "push", "origin", "quiet-otter");

  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "focused-rename",
      checkoutContext: { byspaceHome },
    }),
  ).rejects.toThrow("Published branches cannot be renamed");
});

test("rechecks publication before applying the delayed initial auto-name", async () => {
  const { root, byspaceHome, repo, worktree } = createManagedWorktree("quiet-otter");
  const remote = path.join(root, "remote.git");
  git(root, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(worktree, "push", "origin", "quiet-otter");

  await expect(
    attemptFirstAgentBranchAutoName({
      cwd: worktree,
      firstAgentContext: { prompt: "Rename this worktree" },
      generateBranchNameFromContext: async () => "focused-rename",
      checkoutContext: { byspaceHome },
    }),
  ).resolves.toEqual({ attempted: true, renamed: false, branchName: null });
  expect(git(worktree, "branch", "--show-current")).toBe("quiet-otter");
});

test("rechecks BySpace ownership before applying the delayed initial auto-name", async () => {
  const { root, worktree } = createManagedWorktree("quiet-otter");

  await expect(
    attemptFirstAgentBranchAutoName({
      cwd: worktree,
      firstAgentContext: { prompt: "Rename this worktree" },
      generateBranchNameFromContext: async () => "focused-rename",
      checkoutContext: { byspaceHome: path.join(root, "different-home") },
    }),
  ).resolves.toEqual({ attempted: true, renamed: false, branchName: null });
  expect(git(worktree, "branch", "--show-current")).toBe("quiet-otter");
});

function createManagedWorktree(branchName: string): {
  root: string;
  byspaceHome: string;
  repo: string;
  worktree: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "byspace-branch-rename-"));
  cleanupPaths.push(root);
  const byspaceHome = path.join(root, "byspace-home");
  const repo = path.join(root, "repo");
  const worktree = path.join(byspaceHome, "worktrees", "project", branchName);
  mkdirSync(path.dirname(worktree), { recursive: true });
  git(root, "init", "-b", "main", repo);
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test User");
  git(repo, "commit", "--allow-empty", "-m", "initial");
  git(repo, "worktree", "add", "-b", branchName, worktree);
  writeBySpaceWorktreeMetadata(worktree, { baseRefName: "main", baseRef: "refs/heads/main" });
  writeBySpaceWorktreeFirstAgentBranchAutoNameMetadata(worktree, {
    placeholderBranchName: branchName,
  });
  return { root, byspaceHome, repo, worktree };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

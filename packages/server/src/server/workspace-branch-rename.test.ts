import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

import {
  attemptFirstAgentBranchAutoName,
  renameWorkspaceBranch,
} from "./paseo-worktree-service.js";
import {
  writePaseoWorktreeFirstAgentBranchAutoNameMetadata,
  writePaseoWorktreeMetadata,
} from "../utils/worktree-metadata.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

test("renames an unpublished BySpace-generated worktree branch", async () => {
  const { paseoHome, worktree } = createManagedWorktree("quiet-otter");
  const nestedCwd = path.join(worktree, "nested");
  mkdirSync(nestedCwd);

  await expect(
    renameWorkspaceBranch({
      cwd: nestedCwd,
      newBranchName: "focused-rename",
      paseoHome,
    }),
  ).resolves.toEqual({
    previousBranch: "quiet-otter",
    currentBranch: "focused-rename",
  });
  expect(git(worktree, "branch", "--show-current")).toBe("focused-rename");
});

test("renames the provisional branch produced by initial auto-naming", async () => {
  const { paseoHome, worktree } = createManagedWorktree("quiet-otter");
  await attemptFirstAgentBranchAutoName({
    cwd: worktree,
    firstAgentContext: { prompt: "Build focused workspace rename" },
    generateBranchNameFromContext: async () => "initial-prompt-name",
  });

  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "converged-workspace-name",
      paseoHome,
    }),
  ).resolves.toEqual({
    previousBranch: "initial-prompt-name",
    currentBranch: "converged-workspace-name",
  });
});

test("allows a later agent refinement of an auto-named branch", async () => {
  const { paseoHome, worktree } = createManagedWorktree("quiet-otter");
  await attemptFirstAgentBranchAutoName({
    cwd: worktree,
    firstAgentContext: { prompt: "Build focused workspace rename" },
    generateBranchNameFromContext: async () => "initial-prompt-name",
  });

  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "converged-workspace-name",
      paseoHome,
    }),
  ).resolves.toEqual({
    previousBranch: "initial-prompt-name",
    currentBranch: "converged-workspace-name",
  });
  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "final-workspace-name",
      paseoHome,
    }),
  ).resolves.toEqual({
    previousBranch: "converged-workspace-name",
    currentBranch: "final-workspace-name",
  });
});

test("rejects a branch that was renamed outside BySpace", async () => {
  const { paseoHome, worktree } = createManagedWorktree("quiet-otter");
  git(worktree, "branch", "-m", "manually-renamed");

  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "focused-rename",
      paseoHome,
    }),
  ).rejects.toThrow("current BySpace-generated worktree branch");
});

test("rejects a published branch even without an upstream", async () => {
  const { root, paseoHome, repo, worktree } = createManagedWorktree("quiet-otter");
  const remote = path.join(root, "remote.git");
  git(root, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(worktree, "push", "origin", "quiet-otter");

  await expect(
    renameWorkspaceBranch({
      cwd: worktree,
      newBranchName: "focused-rename",
      paseoHome,
    }),
  ).rejects.toThrow("Published branches cannot be renamed");
});

test("rechecks publication before applying the delayed initial auto-name", async () => {
  const { worktree } = createManagedWorktree("quiet-otter");
  const renameCurrentBranch = vi.fn();

  await expect(
    attemptFirstAgentBranchAutoName({
      cwd: worktree,
      firstAgentContext: { prompt: "Rename this worktree" },
      generateBranchNameFromContext: async () => "focused-rename",
      getCurrentBranch: async () => "quiet-otter",
      getBranchUpstreamRef: async () => "refs/remotes/origin/quiet-otter",
      remoteBranchExists: async () => false,
      localBranchExists: async () => false,
      renameCurrentBranch,
    }),
  ).resolves.toEqual({ attempted: true, renamed: false, branchName: null });
  expect(renameCurrentBranch).not.toHaveBeenCalled();
});

test("rechecks BySpace ownership before applying the delayed initial auto-name", async () => {
  const { root, worktree } = createManagedWorktree("quiet-otter");
  const renameCurrentBranch = vi.fn();

  await expect(
    attemptFirstAgentBranchAutoName({
      cwd: worktree,
      firstAgentContext: { prompt: "Rename this worktree" },
      generateBranchNameFromContext: async () => "focused-rename",
      paseoHome: path.join(root, "different-home"),
      renameCurrentBranch,
    }),
  ).resolves.toEqual({ attempted: true, renamed: false, branchName: null });
  expect(renameCurrentBranch).not.toHaveBeenCalled();
});

function createManagedWorktree(branchName: string): {
  root: string;
  paseoHome: string;
  repo: string;
  worktree: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-branch-rename-"));
  cleanupPaths.push(root);
  const paseoHome = path.join(root, "paseo-home");
  const repo = path.join(root, "repo");
  const worktree = path.join(paseoHome, "worktrees", "project", branchName);
  mkdirSync(path.dirname(worktree), { recursive: true });
  git(root, "init", "-b", "main", repo);
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test User");
  git(repo, "commit", "--allow-empty", "-m", "initial");
  git(repo, "worktree", "add", "-b", branchName, worktree);
  writePaseoWorktreeMetadata(worktree, { baseRefName: "main", baseRef: "refs/heads/main" });
  writePaseoWorktreeFirstAgentBranchAutoNameMetadata(worktree, {
    placeholderBranchName: branchName,
  });
  return { root, paseoHome, repo, worktree };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

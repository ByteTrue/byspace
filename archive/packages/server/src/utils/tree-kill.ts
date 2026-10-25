import { execFile } from "node:child_process";
import { promisify } from "node:util";

import treeKill from "tree-kill";

const execFileAsync = promisify(execFile);

export interface TreeKillTarget {
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once?(event: "exit", listener: () => void): unknown;
}

export interface TerminateWithTreeKillOptions {
  gracefulSignal?: NodeJS.Signals;
  forceSignal?: NodeJS.Signals;
  gracefulTimeoutMs: number;
  forceTimeoutMs?: number;
  onForceSignal?: () => void;
}

export type TerminateWithTreeKillResult =
  | "already-exited"
  | "terminated"
  | "killed"
  | "kill-timeout";

// Injection seam: production wires terminateWithTreeKill; tests wire a fake that
// records which children were terminated as observable state.
export type ProcessTerminator = (
  child: TreeKillTarget,
  options: TerminateWithTreeKillOptions,
) => Promise<TerminateWithTreeKillResult>;

export async function terminateWithTreeKill(
  child: TreeKillTarget,
  options: TerminateWithTreeKillOptions,
): Promise<TerminateWithTreeKillResult> {
  if (isProcessExited(child)) {
    return "already-exited";
  }

  const exitPromise = waitForProcessExit(child);
  await signalProcessTree(child, options.gracefulSignal ?? "SIGTERM");
  if (await waitForExitOrTimeout(exitPromise, options.gracefulTimeoutMs)) {
    return "terminated";
  }

  options.onForceSignal?.();
  await signalProcessTree(child, options.forceSignal ?? "SIGKILL");
  if (options.forceTimeoutMs === undefined) {
    return "killed";
  }
  return (await waitForExitOrTimeout(exitPromise, options.forceTimeoutMs))
    ? "killed"
    : "kill-timeout";
}

/**
 * `rootPid` and every process below it, parents before children.
 *
 * Walks PPID links from a `ps` snapshot, so it reaches descendants that left the
 * root's process group — an interactive shell with job control puts each command
 * in its own group, and `detached: true` leaves one outright. `process.kill(pid)`
 * and a process-group signal both miss those.
 *
 * POSIX only. Windows has neither `ps` nor a PPID walk; the console process list
 * is the authority there, and callers use it instead.
 */
export async function listProcessTreePids(rootPid: number): Promise<number[]> {
  if (process.platform === "win32" || !Number.isInteger(rootPid) || rootPid <= 0) {
    return rootPid > 0 ? [rootPid] : [];
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-Ao", "pid=,ppid="], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return expandProcessTree(rootPid, parseProcessParents(stdout));
  } catch {
    // `ps` is missing or refused; the caller still has to signal the root.
    return [rootPid];
  }
}

function parseProcessParents(stdout: string): Map<number, number[]> {
  const childrenByParent = new Map<number, number[]>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const siblings = childrenByParent.get(parentPid);
    if (siblings) {
      siblings.push(pid);
    } else {
      childrenByParent.set(parentPid, [pid]);
    }
  }
  return childrenByParent;
}

function expandProcessTree(rootPid: number, childrenByParent: Map<number, number[]>): number[] {
  const ordered: number[] = [];
  const pending: number[] = [rootPid];
  const seen = new Set<number>();
  while (pending.length > 0) {
    const pid = pending.shift() as number;
    if (seen.has(pid)) {
      continue;
    }
    seen.add(pid);
    ordered.push(pid);
    const children = childrenByParent.get(pid);
    if (children) {
      pending.push(...children);
    }
  }
  return ordered;
}

export function signalProcessTree(child: TreeKillTarget, signal: NodeJS.Signals): Promise<void> {
  if (isProcessExited(child)) {
    return Promise.resolve();
  }

  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 0) {
    signalDirectChild(child, signal);
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return forceKillWindowsTree(child, pid, signal);
  }

  return new Promise((resolve) => {
    treeKill(pid, signal, (error) => {
      if (error) {
        signalDirectChild(child, signal);
      }
      resolve();
    });
  });
}

// tree-kill shells taskkill through cmd.exe with no windowsHide, so the
// console-less daemon pops a visible window on every kill. Its win32 branch
// ignores the signal and always force-kills, so this is the same command.
function forceKillWindowsTree(
  child: TreeKillTarget,
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  return new Promise((resolve) => {
    execFile("taskkill.exe", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, (error) => {
      if (error) {
        signalDirectChild(child, signal);
      }
      resolve();
    });
  });
}

function signalDirectChild(child: TreeKillTarget, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // Ignore cleanup races.
  }
}

function isProcessExited(child: TreeKillTarget): boolean {
  return (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  );
}

function waitForProcessExit(child: TreeKillTarget): Promise<void> {
  if (isProcessExited(child)) {
    return Promise.resolve();
  }
  if (!child.once) {
    return new Promise(() => undefined);
  }

  return new Promise((resolve) => {
    child.once?.("exit", resolve);
  });
}

async function waitForExitOrTimeout(
  exitPromise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      exitPromise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

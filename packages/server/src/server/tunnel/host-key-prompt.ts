/**
 * Host-key confirmation prompts for daemon-owned SSH tunnels.
 *
 * A prompt is emitted to the client that opened the tunnel; the handshake
 * stays suspended until the client answers `tunnel.ssh.respond-host-key` or
 * the prompt times out (then the tunnel fails closed).
 */

export const SSH_HOST_KEY_PROMPT_TIMEOUT_MS = 120_000;

export interface SshHostKeyPrompt {
  promptId: string;
  target: string;
  kind: "first-use" | "changed";
  fingerprint: string;
  pinnedFingerprint?: string;
}

export type SshHostKeyDecision = "trust" | "cancel";

export interface HostKeyPromptManager {
  ask(prompt: SshHostKeyPrompt): Promise<SshHostKeyDecision>;
  respond(input: { promptId: string; decision: SshHostKeyDecision }): boolean;
  cancelAll(): void;
}

export interface HostKeyPromptManagerOptions {
  emitPrompt: (prompt: SshHostKeyPrompt) => void;
  scheduleTimeout: (callback: () => void, delayMs: number) => () => void;
}

interface PendingPrompt {
  prompt: SshHostKeyPrompt;
  resolve: (decision: SshHostKeyDecision) => void;
  cancelTimeout: () => void;
}

export function createHostKeyPromptManager(
  options: HostKeyPromptManagerOptions,
): HostKeyPromptManager {
  const pending = new Map<string, PendingPrompt>();

  function settle(promptId: string, decision: SshHostKeyDecision): void {
    const entry = pending.get(promptId);
    if (!entry) return;
    pending.delete(promptId);
    entry.cancelTimeout();
    entry.resolve(decision);
  }

  return {
    ask(prompt) {
      return new Promise<SshHostKeyDecision>((resolve) => {
        const entry: PendingPrompt = {
          prompt,
          resolve,
          cancelTimeout: () => undefined,
        };
        // A repeated prompt id replaces the earlier pending entry; the old
        // promise stays unresolved until its own timeout fires.
        const existing = pending.get(prompt.promptId);
        if (existing) {
          pending.delete(prompt.promptId);
          existing.cancelTimeout();
          existing.resolve("cancel");
        }
        pending.set(prompt.promptId, entry);
        entry.cancelTimeout = options.scheduleTimeout(() => {
          if (pending.get(prompt.promptId) === entry) {
            pending.delete(prompt.promptId);
            resolve("cancel");
          }
        }, SSH_HOST_KEY_PROMPT_TIMEOUT_MS);
        options.emitPrompt(prompt);
      });
    },
    respond(input) {
      if (!pending.has(input.promptId)) return false;
      settle(input.promptId, input.decision);
      return true;
    },
    cancelAll() {
      for (const entry of pending.values()) {
        entry.cancelTimeout();
        entry.resolve("cancel");
      }
      pending.clear();
    },
  };
}

export type SshHostKeyPromptKind = "first-use" | "changed";

export interface SshHostKeyPrompt {
  promptId: string;
  target: string;
  kind: SshHostKeyPromptKind;
  fingerprint: string;
  pinnedFingerprint?: string;
}

export type SshHostKeyPromptDecision = "trust" | "cancel";

export interface SshHostKeyPromptResponse {
  promptId: string;
  decision: SshHostKeyPromptDecision;
}

export interface HostKeyPromptManagerDependencies {
  emitPrompt(prompt: SshHostKeyPrompt): void;
  scheduleTimeout(callback: () => void, delayMs: number): () => void;
}

export const SSH_HOST_KEY_PROMPT_TIMEOUT_MS = 120_000;

interface PendingPrompt {
  resolve: (decision: SshHostKeyPromptDecision) => void;
  cancelTimeout: () => void;
  promise: Promise<SshHostKeyPromptDecision>;
}

export interface HostKeyPromptManager {
  ask(prompt: SshHostKeyPrompt): Promise<SshHostKeyPromptDecision>;
  respond(response: SshHostKeyPromptResponse): void;
  cancelAll(): void;
}

/**
 * Bridges host-key verification (which runs inside the SSH handshake) to the
 * renderer, where a modal asks the user to trust or reject the fingerprint.
 * Trusting also persists the pin. Prompts that nobody answers expire as a
 * cancel so a handshake can never hang on a hidden dialog.
 */
export function createHostKeyPromptManager(
  deps: HostKeyPromptManagerDependencies,
): HostKeyPromptManager {
  const pending = new Map<string, PendingPrompt>();

  function settle(promptId: string, decision: SshHostKeyPromptDecision): void {
    const entry = pending.get(promptId);
    if (!entry) {
      return;
    }
    pending.delete(promptId);
    entry.cancelTimeout();
    entry.resolve(decision);
  }

  return {
    ask(prompt) {
      const existing = pending.get(prompt.promptId);
      if (existing) {
        return existing.promise;
      }
      const entry: PendingPrompt = {
        resolve: () => undefined,
        cancelTimeout: () => undefined,
        promise: Promise.resolve("cancel"),
      };
      entry.promise = new Promise<SshHostKeyPromptDecision>((resolve) => {
        entry.resolve = resolve;
      });
      entry.cancelTimeout = deps.scheduleTimeout(() => {
        settle(prompt.promptId, "cancel");
      }, SSH_HOST_KEY_PROMPT_TIMEOUT_MS);
      pending.set(prompt.promptId, entry);
      deps.emitPrompt(prompt);
      return entry.promise;
    },

    respond(response) {
      settle(response.promptId, response.decision);
    },

    cancelAll() {
      for (const promptId of Array.from(pending.keys())) {
        settle(promptId, "cancel");
      }
    },
  };
}

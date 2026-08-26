import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";

interface ClientActivityOptions {
  client: DaemonClient;
  focusedAgentId: string | null;
  focusedTerminalId: string | null;
  onUserActivity: () => void;
  onAppResumed?: (awayMs: number) => void;
  onWindowFocused?: () => void;
}

export declare function useClientActivity(options: ClientActivityOptions): void;

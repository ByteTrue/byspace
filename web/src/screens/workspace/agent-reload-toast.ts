import type { ToastApi } from "@/widgets/toast-host";

interface AgentReloadToastLabels {
  loading: string;
  success: string;
  failure: string;
}

export async function runAgentReloadWithToast(
  toast: Pick<ToastApi, "show">,
  agentId: string,
  labels: AgentReloadToastLabels,
  reload: () => Promise<void>,
): Promise<void> {
  const id = `agent-reload:${agentId}`;
  toast.show(labels.loading, { id, durationMs: null });
  try {
    await reload();
    toast.show(labels.success, { id, variant: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    toast.show(message.trim() ? message : labels.failure, { id, variant: "error" });
  }
}

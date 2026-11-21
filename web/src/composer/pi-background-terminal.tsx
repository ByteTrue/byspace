import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ComposerTrackPill,
  ComposerTrackRow,
  type ComposerTrackPillSegment,
} from "@/composer/tracks";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";

interface PiBackgroundTerminalScope {
  serverId: string;
  agentId: string;
}

export function PiBackgroundTerminalTrack({ serverId, agentId }: PiBackgroundTerminalScope) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  if (!client || !isConnected) return null;
  return (
    <ConnectedPiBackgroundTerminalTrack
      key={`${serverId}:${agentId}`}
      client={client}
      serverId={serverId}
      agentId={agentId}
    />
  );
}

function ConnectedPiBackgroundTerminalTrack({
  client,
  serverId,
  agentId,
}: PiBackgroundTerminalScope & { client: DaemonClient }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["pi-background-terminal", serverId, agentId];
  const stop = useMutation({
    mutationFn: async (taskId: string) => {
      const result = await client.managePiBackgroundTerminal(agentId, taskId);
      if (result.error !== null || result.tasks === null) {
        throw new Error(result.error ?? t("piBackgroundTerminal.unavailable"));
      }
      return result.tasks;
    },
    onSuccess: async (tasks) => {
      // A poll started before the stop may still carry the old running status.
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, tasks);
    },
  });
  // retry:false resets react-query's failureCount each fetch, so count consecutive failures
  // here; keepPreviousData would otherwise show a stale running roster forever after the agent
  // dies. State (not a ref) so the third failure re-renders; resets on success or remount.
  const [listFailures, setListFailures] = useState(0);
  const { data: tasks } = useFetchQuery({
    queryKey,
    queryFn: async () => {
      try {
        const result = await client.managePiBackgroundTerminal(agentId);
        if (result.error !== null) throw new Error(result.error);
        setListFailures(0);
        return result.tasks;
      } catch (error) {
        setListFailures((n) => n + 1);
        throw error;
      }
    },
    dataShape: "list",
    staleTimeMs: 0,
    refetchInterval: (query) => {
      if (stop.isPending) return false;
      // Availability is fixed per session, but a restart can load the extension under the same
      // key — slow down instead of stopping when the roster is unavailable.
      return query.state.data == null ? 60_000 : 10_000;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  const { mutate } = stop;
  const handleStop = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => mutate(event.currentTarget.value),
    [mutate],
  );
  const running = tasks?.filter((task) => task.status === "running").length ?? 0;
  const segments = useMemo<ComposerTrackPillSegment[]>(
    () => [
      {
        bucket: running > 0 ? "running" : null,
        text: t("piBackgroundTerminal.count", { count: running }),
      },
    ],
    [running, t],
  );
  if (!tasks?.length || listFailures >= 3) return null;

  const title = t("piBackgroundTerminal.title");
  return (
    <ComposerTrackPill
      segments={segments}
      panelTitle={title}
      accessibilityLabel={t("piBackgroundTerminal.accessibilityLabel", { count: running })}
      testID="pi-background-terminal-track"
    >
      <div className="w-80 max-w-[calc(100vw-2rem)]" aria-label={title} role="group">
        {stop.isError ? (
          <p role="alert" className="px-3 py-1 text-sm wrap-anywhere text-destructive">
            {t("piBackgroundTerminal.stopFailed")} {stop.error.message}
          </p>
        ) : null}
        {tasks.map((task) => (
          <ComposerTrackRow key={task.id}>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm wrap-anywhere whitespace-pre-wrap">
                {task.command}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(`piBackgroundTerminal.status.${task.status}`)}
              </div>
            </div>
            {task.status === "running" ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={t("piBackgroundTerminal.stopCommand", { command: task.command })}
                aria-busy={stop.isPending && stop.variables === task.id}
                disabled={stop.isPending}
                onClick={handleStop}
                value={task.id}
              >
                {stop.isPending && stop.variables === task.id ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {t("piBackgroundTerminal.stop")}
              </Button>
            ) : null}
          </ComposerTrackRow>
        ))}
      </div>
    </ComposerTrackPill>
  );
}

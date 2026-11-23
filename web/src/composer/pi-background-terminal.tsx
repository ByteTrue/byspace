import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { useQueryClient } from "@tanstack/react-query";
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
  const queryKey = useMemo(
    () => ["pi-background-terminal", serverId, agentId],
    [serverId, agentId],
  );
  const [stoppingIds, setStoppingIds] = useState<ReadonlySet<string>>(new Set());
  const [stopErrors, setStopErrors] = useState<Readonly<Record<string, string>>>({});
  const query = useFetchQuery({
    queryKey,
    queryFn: async () => {
      const result = await client.managePiBackgroundTerminal(agentId);
      if (result.error !== null) throw new Error(result.error);
      return result.tasks;
    },
    dataShape: "list",
    staleTimeMs: 0,
    refetchInterval: (current) => (current.state.data == null ? 60_000 : 10_000),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const tasks = query.data;
  const refetch = query.refetch;
  const handleStop = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      const taskId = event.currentTarget.value;
      if (stoppingIds.has(taskId)) return;
      setStoppingIds((current) => new Set(current).add(taskId));
      setStopErrors((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
      try {
        const result = await client.managePiBackgroundTerminal(agentId, taskId);
        if (result.error !== null || result.tasks === null) {
          throw new Error(result.error ?? t("piBackgroundTerminal.unavailable"));
        }
        // A poll started before the stop may still carry the old running status.
        await queryClient.cancelQueries({ queryKey, exact: true });
        queryClient.setQueryData(queryKey, result.tasks);
      } catch (error) {
        setStopErrors((current) => ({
          ...current,
          [taskId]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setStoppingIds((current) => {
          const next = new Set(current);
          next.delete(taskId);
          return next;
        });
      }
    },
    [agentId, client, queryClient, queryKey, stoppingIds, t],
  );
  const dismissError = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const taskId = event.currentTarget.value;
    setStopErrors((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }, []);
  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);
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
  const visibleTasks = tasks?.filter((task) => task.status === "running" || stopErrors[task.id]);
  if (!visibleTasks?.length) return null;

  const panelTitle = t("piBackgroundTerminal.title");
  return (
    <ComposerTrackPill
      segments={segments}
      panelTitle={panelTitle}
      accessibilityLabel={t("piBackgroundTerminal.accessibilityLabel", { count: running })}
      testID="pi-background-terminal-track"
    >
      <div className="w-96 max-w-[calc(100vw-2rem)]" aria-label={panelTitle} role="group">
        {query.isError ? (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-destructive">
            <span className="min-w-0 flex-1">{t("piBackgroundTerminal.listFailed")}</span>
            <Button type="button" variant="outline" size="xs" onClick={handleRetry}>
              {t("common.actions.retry")}
            </Button>
          </div>
        ) : null}
        {visibleTasks.map((task) => {
          const stopping = stoppingIds.has(task.id);
          const error = stopErrors[task.id];
          const title = task.description?.trim() || task.command;
          const elapsed = task.startedAt ? formatElapsed(task.startedAt) : null;
          return (
            <div key={task.id}>
              <ComposerTrackRow accessibilityLabel={title}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground" title={title}>
                    {title}
                  </div>
                  {task.command !== title ? (
                    <div className="truncate text-xs text-muted-foreground" title={task.command}>
                      {task.command}
                    </div>
                  ) : null}
                  <div className="truncate text-xs text-muted-foreground">
                    {task.kind === "shell" || !task.kind
                      ? t("piBackgroundTerminal.kind")
                      : task.kind}{" "}
                    ·{" "}
                    {stopping
                      ? t("piBackgroundTerminal.stopping")
                      : t(`piBackgroundTerminal.status.${task.status}`)}
                    {elapsed ? " · " + elapsed : ""}
                  </div>
                </div>
                {task.status === "running" && task.canStop !== false ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-label={t("piBackgroundTerminal.stopCommand", { command: task.command })}
                    aria-busy={stopping}
                    disabled={stopping}
                    onClick={handleStop}
                    value={task.id}
                  >
                    {stopping ? <Spinner data-icon="inline-start" /> : null}
                    {t("piBackgroundTerminal.stop")}
                  </Button>
                ) : null}
              </ComposerTrackRow>
              {error ? (
                <div
                  role="alert"
                  className="mx-3 mb-2 flex items-start gap-2 text-xs text-destructive"
                >
                  <span className="min-w-0 flex-1 wrap-anywhere">
                    {t("piBackgroundTerminal.stopFailed")} {error}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={dismissError}
                    value={task.id}
                  >
                    {t("common.actions.dismiss")}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </ComposerTrackPill>
  );
}

function formatElapsed(startedAt: string): string | null {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

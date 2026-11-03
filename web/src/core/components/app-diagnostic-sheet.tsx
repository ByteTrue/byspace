// Port of archive/expo-app:packages/app/src/components/app-diagnostic-sheet.tsx: the app diagnostic — live progress, then the redacted report. Same logic, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/app-diagnostic-sheet.py; edit it directly.
import * as Clipboard from "~/lib/clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollableCodeSurface, SurfaceCard } from "@/components/ui/scrollable-code-surface";
import { useToast } from "@/contexts/toast-context";
import {
  formatAppDiagnosticHeader,
  formatDiagnosticSection,
  formatHostRuntimeSection,
  formatServerInfoSection,
  redactAppDiagnosticReport,
} from "@/diagnostics/app-diagnostic-report";
import { collectDesktopDiagnosticSections } from "@/diagnostics/desktop-diagnostic-report";
import { getHostRuntimeStore, useHosts, type HostRuntimeSnapshot } from "@/runtime/host-runtime";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { HostProfile } from "@/types/host-connection";
import { withTheme } from "~/app/theme-object";

interface AppDiagnosticSheetProps {
  visible: boolean;
  onClose: () => void;
  appVersion: string | null;
  isDesktopApp: boolean;
}

type ProgressStatus = "pending" | "running" | "done" | "failed";

interface ProgressRow {
  id: string;
  label: string;
  status: ProgressStatus;
}

interface DiagnosticCollectionResult {
  sections: string[];
  status: ProgressStatus;
}

const SNAP_POINTS = ["55%", "88%"];
const ThemedCopy = withTheme(Copy);
const ThemedRotateCw = withTheme(RotateCw);
const ThemedLoadingSpinner = withTheme(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export function AppDiagnosticSheet({
  visible,
  onClose,
  appVersion,
  isDesktopApp,
}: AppDiagnosticSheetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const hosts = useHosts();
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const runIdRef = useRef(0);

  const updateProgress = useCallback((id: string, label: string, status: ProgressStatus) => {
    setProgress((current) => {
      const existing = current.find((row) => row.id === id);
      if (existing) {
        return current.map((row) => (row.id === id ? { ...row, label, status } : row));
      }
      return [...current, { id, label, status }];
    });
  }, []);

  const runDiagnostics = useCallback(async () => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const isCurrentRun = () => runIdRef.current === runId;
    const updateRunProgress = (id: string, label: string, status: ProgressStatus) => {
      if (isCurrentRun()) {
        updateProgress(id, label, status);
      }
    };

    setLoading(true);
    setDiagnostic(null);
    setProgress([]);

    const sections: string[] = [];
    try {
      updateRunProgress("client", t("settings.diagnostics.app.progress.client"), "running");
      sections.push(
        formatAppDiagnosticHeader({
          appVersion,
          platform: "web",
          isDesktopApp,
          hostCount: hosts.length,
        }),
      );
      updateRunProgress("client", t("settings.diagnostics.app.progress.client"), "done");

      if (isDesktopApp) {
        const desktopLabel = t("settings.diagnostics.app.progress.desktop");
        updateRunProgress("desktop", desktopLabel, "running");
        const desktopResult = await collectDesktopDiagnosticSections();
        sections.push(...desktopResult.sections);
        updateRunProgress("desktop", desktopLabel, desktopResult.status);
      }

      const store = getHostRuntimeStore();
      for (const host of hosts) {
        const hostProgressId = `host:${host.serverId}`;
        updateRunProgress(hostProgressId, host.label, "running");
        const snapshot = store.getSnapshot(host.serverId);
        const hostResult = await collectHostDiagnosticSections(host, snapshot);
        sections.push(...hostResult.sections);
        updateRunProgress(hostProgressId, host.label, hostResult.status);
      }

      if (isCurrentRun()) {
        setDiagnostic(redactAppDiagnosticReport(sections.join("\n\n"), hosts));
      }
    } finally {
      if (isCurrentRun()) {
        setLoading(false);
      }
    }
  }, [appVersion, hosts, isDesktopApp, t, updateProgress]);

  useEffect(() => {
    if (visible) {
      void runDiagnostics();
    } else {
      runIdRef.current += 1;
      setLoading(false);
      setDiagnostic(null);
      setProgress([]);
    }
  }, [visible, runDiagnostics]);

  const handleRefreshPress = useCallback(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const handleCopyPress = useCallback(() => {
    if (!diagnostic) return;
    void Clipboard.writeText(diagnostic)
      .then(() => toast.copied(t("settings.diagnostics.app.copyLabel")))
      .catch(() => toast.error(t("settings.diagnostics.app.copyFailed")));
  }, [diagnostic, t, toast]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.diagnostics.app.title"),
      actions: (
        <div className="flex flex-row items-center gap-1">
          <button
            type="button"
            onClick={handleCopyPress}
            disabled={!diagnostic}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted active:bg-muted disabled:pointer-events-none disabled:opacity-50"
            aria-label={t("settings.diagnostics.app.copyAccessibility")}
          >
            <ThemedCopy size={ICON_SIZE.sm} themeProps={foregroundMutedColorMapping} />
          </button>
          <button
            type="button"
            onClick={handleRefreshPress}
            disabled={loading}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted active:bg-muted disabled:pointer-events-none disabled:opacity-50 disabled:opacity-100"
            aria-label={
              loading
                ? t("settings.diagnostics.app.refreshingAccessibility")
                : t("settings.diagnostics.app.refreshAccessibility")
            }
          >
            {loading ? (
              <ThemedLoadingSpinner size={ICON_SIZE.sm} themeProps={foregroundMutedColorMapping} />
            ) : (
              <ThemedRotateCw size={ICON_SIZE.sm} themeProps={foregroundMutedColorMapping} />
            )}
          </button>
        </div>
      ),
    }),
    [diagnostic, handleCopyPress, handleRefreshPress, loading, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS}
      scrollable={false}
      testID="app-diagnostic-sheet"
    >
      {diagnostic ? (
        <ScrollableCodeSurface key={visible ? "visible" : "hidden"} maxHeight={520}>
          {diagnostic}
        </ScrollableCodeSurface>
      ) : (
        <SurfaceCard key={visible ? "visible" : "hidden"}>
          <div className="flex flex-col gap-3 p-4">
            {progress.length === 0 ? (
              <div className="flex min-h-6 flex-row items-center gap-2">
                <ThemedLoadingSpinner
                  size={ICON_SIZE.sm}
                  themeProps={foregroundMutedColorMapping}
                />
                <span className="flex-1 text-sm text-muted-foreground">
                  {t("settings.diagnostics.app.running")}
                </span>
              </div>
            ) : (
              progress.map((row) => (
                <div key={row.id} className="flex min-h-6 flex-row items-center gap-2">
                  {row.status === "running" || row.status === "pending" ? (
                    <ThemedLoadingSpinner
                      size={ICON_SIZE.sm}
                      themeProps={foregroundMutedColorMapping}
                    />
                  ) : (
                    <div
                      className={
                        row.status === "failed"
                          ? "size-2 rounded-full bg-destructive"
                          : "size-2 rounded-full bg-primary"
                      }
                    />
                  )}
                  <span className="flex-1 text-sm text-muted-foreground">
                    {`${row.label}: ${formatProgressStatus(row.status)}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>
      )}
    </AdaptiveModalSheet>
  );
}

async function collectHostDiagnosticSections(
  host: HostProfile,
  snapshot: HostRuntimeSnapshot | null,
): Promise<DiagnosticCollectionResult> {
  const sections = [formatHostRuntimeSection({ host, snapshot })];
  const client = snapshot?.client ?? null;
  if (snapshot?.connectionStatus !== "online" || !client) {
    sections.push(
      formatDiagnosticSection(`Host diagnostics: ${host.label}`, [
        { label: "Status", value: "host is not connected" },
      ]),
    );
    return { sections, status: "done" };
  }

  try {
    const serverInfo = client.getLastServerInfoMessage();
    sections.push(formatServerInfoSection(serverInfo));

    const rttMs = await client.measureLatency({ timeoutMs: 5000 });
    sections.push(
      formatDiagnosticSection(`Host latency: ${host.label}`, [
        { label: "Active RTT", value: `${Math.round(rttMs)}ms` },
      ]),
    );

    if (serverInfo?.features?.daemonDiagnostics === true) {
      const result = await client.collectDiagnostics();
      sections.push(result.diagnostic);
    } else {
      sections.push(
        formatDiagnosticSection(`Daemon diagnostics: ${host.label}`, [
          { label: "Status", value: "unsupported by this daemon" },
        ]),
      );
    }

    return { sections, status: "done" };
  } catch (error) {
    sections.push(
      formatDiagnosticSection(`Host diagnostics: ${host.label}`, [
        { label: "Error", value: toMessage(error) },
      ]),
    );
    return { sections, status: "failed" };
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatProgressStatus(status: ProgressStatus): string {
  switch (status) {
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "running":
    case "pending":
      return "running";
  }
}

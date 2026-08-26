import { useFetchQuery } from "@/data/query";
import { getDesktopHost, type DesktopEditorBridge } from "@/desktop/host";

export type DesktopOpenTargetKind = "editor" | "file-manager";
export type DesktopOpenTargetIcon =
  | { kind: "image"; dataUrl: string }
  | { kind: "symbol"; name: "folder" | "terminal" };

export interface DesktopOpenTarget {
  id: string;
  label: string;
  kind: DesktopOpenTargetKind;
  icon: DesktopOpenTargetIcon;
}

export interface OpenDesktopTargetInput {
  editorId: string;
  workspacePath: string;
  filePath?: string;
  line?: number;
  column?: number;
}

interface AvailableDesktopEditorBridge {
  listTargets: NonNullable<DesktopEditorBridge["listTargets"]>;
  openTarget: NonNullable<DesktopEditorBridge["openTarget"]>;
}

function getDesktopEditorBridge(): AvailableDesktopEditorBridge | null {
  const bridge = getDesktopHost()?.editor;
  if (!bridge?.listTargets || !bridge.openTarget) return null;
  return { listTargets: bridge.listTargets, openTarget: bridge.openTarget };
}

export function hasDesktopOpenTargetsBridge(): boolean {
  return getDesktopEditorBridge() !== null;
}

export async function listDesktopOpenTargets(): Promise<DesktopOpenTarget[]> {
  return (await getDesktopEditorBridge()?.listTargets()) ?? [];
}

export async function openDesktopTarget(input: OpenDesktopTargetInput): Promise<void> {
  const bridge = getDesktopEditorBridge();
  if (!bridge) throw new Error("Desktop editor bridge is unavailable");
  await bridge.openTarget(input);
}

export function useDesktopOpenTargets(input: { isLocalExecution: boolean }) {
  const canListTargets = hasDesktopOpenTargetsBridge() && input.isLocalExecution;
  const query = useFetchQuery({
    queryKey: ["desktop-open-targets"],
    enabled: canListTargets,
    dataShape: "list",
    staleTimeMs: 60_000,
    retry: false,
    queryFn: listDesktopOpenTargets,
  });
  return { targets: query.data ?? [], isAvailable: canListTargets };
}

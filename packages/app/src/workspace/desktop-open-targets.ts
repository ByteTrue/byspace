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

/** Desktop editor integration is intentionally unavailable in the browser-only client. */
export function hasDesktopOpenTargetsBridge(): boolean {
  return false;
}

export async function listDesktopOpenTargets(): Promise<DesktopOpenTarget[]> {
  return [];
}

export async function openDesktopTarget(_input: OpenDesktopTargetInput): Promise<void> {
  throw new Error("Desktop editor integration is unavailable in the browser client");
}

export function useDesktopOpenTargets(_input: { isLocalExecution: boolean }) {
  return {
    targets: [] as DesktopOpenTarget[],
    isAvailable: false,
  };
}

/** Desktop open-targets shim (Electron retired, issue 025 A3). */
export interface DesktopOpenTarget {
  id: string;
  kind: string;
  label: string;
  [key: string]: unknown;
}

export interface DesktopOpenTargetIcon {
  kind: string;
  dataUrl?: string;
  [key: string]: unknown;
}

export function useDesktopOpenTargets(_input: Record<string, unknown>): {
  targets: DesktopOpenTarget[];
  isAvailable: false;
} {
  return { targets: [], isAvailable: false };
}

export interface OpenDesktopTargetInput {
  targetId?: string;
  editorId?: string;
  workspaceId?: string;
  workspacePath?: string;
  path?: string;
  filePath?: string;
  [key: string]: unknown;
}

export function openDesktopTarget(_input: OpenDesktopTargetInput): Promise<void> {
  return Promise.resolve();
}

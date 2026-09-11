/** Browser store shim (Electron retired, issue 025 A3). No browsers exist on web. */

interface NoopBrowserStore {
  removeBrowser(_browserId: string): void;
}

export const useBrowserStore = {
  getState(): NoopBrowserStore {
    return { removeBrowser: () => undefined };
  },
};

export function createWorkspaceBrowser(_input?: { initialUrl?: string }): { browserId: string } {
  return { browserId: `browser-shim-${Date.now()}` };
}

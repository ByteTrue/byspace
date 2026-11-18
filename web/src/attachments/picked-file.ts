export interface PickedFile {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

// Desktop bridge retired (issue 025): OS file paths can no longer be read from
// the web runtime. No call site produces desktop-path items anymore; the export
// stays until the remaining desktop picker call sites are cleaned up.
export async function readDesktopFileBytes(path: string): Promise<Uint8Array> {
  throw new Error(
    `Reading file bytes from OS path '${path}' requires the retired desktop runtime.`,
  );
}

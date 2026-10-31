// Stand-in for expo-file-system/legacy; see expo-file-system.ts. Not reached on the web.
export interface DownloadProgressData {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
}

export function createDownloadResumable(
  _url: string,
  _fileUri: string,
  _options?: { headers?: Record<string, string> },
  _callback?: (data: DownloadProgressData) => void,
): { downloadAsync(): Promise<{ uri: string } | undefined> } {
  throw new Error("expo-file-system/legacy createDownloadResumable is not available on the web");
}

// Stand-in for expo-sharing: the native share sheet. On the web a download is a browser download,
// so sharing is never offered.
export async function isAvailableAsync(): Promise<boolean> {
  return false;
}

export async function shareAsync(
  _url: string,
  _options?: { mimeType?: string; dialogTitle?: string },
): Promise<void> {
  throw new Error("expo-sharing is not available on the web");
}

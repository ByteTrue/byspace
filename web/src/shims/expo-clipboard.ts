// Transitional stand-in for `expo-clipboard`, backed by the async Clipboard API. Deleted at the cutover.
export async function setStringAsync(text: string): Promise<boolean> {
  await navigator.clipboard.writeText(text);
  return true;
}

export async function getStringAsync(): Promise<string> {
  return await navigator.clipboard.readText();
}

export async function hasStringAsync(): Promise<boolean> {
  return (await getStringAsync()).length > 0;
}

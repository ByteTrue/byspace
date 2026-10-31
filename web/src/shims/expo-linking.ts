// Transitional stand-in for `expo-linking`, backed by the browser location. Deleted at the cutover.
export async function openURL(url: string): Promise<true> {
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

export async function getInitialURL(): Promise<string | null> {
  return window.location.href;
}

export function addEventListener(type: "url", handler: (event: { url: string }) => void) {
  // On the web a pairing link arrives as a hash change on the already-open page.
  const listener = () => handler({ url: window.location.href });
  window.addEventListener("hashchange", listener);
  return { remove: () => window.removeEventListener("hashchange", listener) };
}

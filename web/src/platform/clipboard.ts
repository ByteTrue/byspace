// Clipboard text through the async Clipboard API. When the API is missing or refuses (no
// permission, an insecure origin, a sandboxed frame), copying falls back to a hidden textarea and
// reports whether that worked. It never rejects, so callers that do not catch do not raise an
// unhandled rejection.
function copyWithTextarea(text: string): boolean {
  const field = document.createElement("textarea");
  field.textContent = text;
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export async function writeText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return copyWithTextarea(text);
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyWithTextarea(text);
  }
}

export async function readText(): Promise<string> {
  return await navigator.clipboard.readText();
}

export async function hasText(): Promise<boolean> {
  return (await readText()).length > 0;
}

async function readImageBlob(): Promise<Blob | null> {
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((candidate) => candidate.startsWith("image/"));
    if (type) return await item.getType(type);
  }
  return null;
}

/** The clipboard's image as a data URL, or null when it holds none. */
export async function readImageDataUrl(): Promise<string | null> {
  const blob = await readImageBlob();
  if (!blob) return null;
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

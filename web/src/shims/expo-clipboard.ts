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

async function readImageBlob(): Promise<Blob | null> {
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((candidate) => candidate.startsWith("image/"));
    if (type) return await item.getType(type);
  }
  return null;
}

export async function hasImageAsync(): Promise<boolean> {
  return (await readImageBlob()) !== null;
}

/** The clipboard's image as a data URL, as expo-clipboard returns it. */
export async function getImageAsync(_options: {
  format: "png" | "jpeg";
}): Promise<{ data: string } | null> {
  const blob = await readImageBlob();
  if (!blob) return null;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
  return { data };
}

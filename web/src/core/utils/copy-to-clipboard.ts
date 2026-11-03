import * as Clipboard from "~/lib/clipboard";

export async function copyToClipboard(text: string): Promise<void> {
  await Clipboard.writeText(text);
}

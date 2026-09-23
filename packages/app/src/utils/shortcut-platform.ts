import type { ShortcutOs } from "@/utils/format-shortcut";

export function getShortcutOs(): ShortcutOs {
  if (typeof navigator === "undefined") return "non-mac";
  const ua = navigator.userAgent ?? "";
  const platform = (navigator as Navigator & { platform?: string }).platform ?? "";
  const isApple =
    /Macintosh|Mac OS|iPhone|iPad|iPod/i.test(ua) || /Mac|iPhone|iPad|iPod/i.test(platform);
  return isApple ? "mac" : "non-mac";
}

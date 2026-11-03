import { useMemo } from "react";
import { getFileIconSvg } from "@/components/file-icon-svg";

/** The Expo app's MaterialFileIcon: the Material icon theme glyph for a file name, as an image. */
export function FileIcon({ fileName, size = 16 }: { fileName: string; size?: number }) {
  const src = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(getFileIconSvg(fileName))}`,
    [fileName],
  );
  return <img src={src} alt="" width={size} height={size} className="shrink-0" />;
}

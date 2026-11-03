// Port of packages/app/src/components/file-drop/file-drop-backdrop.tsx: "Drop files here" over
// the drop area while a drag is over it and a consumer can take the files. Opacity is written to
// the node from the drag flags, so the dim never repaints anything else.
import { useLayoutEffect, useRef } from "react";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFileDropContext } from "@/components/file-drop/context";

let nextListenerId = 1;

export function FileDropBackdrop() {
  const { t } = useTranslation();
  const ctx = useFileDropContext();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!ctx) return;
    const { isDragging, suppressed, hasSink } = ctx;
    const update = () => {
      const node = overlayRef.current;
      if (node)
        node.style.opacity = isDragging.value && hasSink.value && !suppressed.value ? "1" : "0";
    };
    const id = nextListenerId++;
    for (const flag of [isDragging, suppressed, hasSink]) flag.addListener(id, update);
    update();
    return () => {
      for (const flag of [isDragging, suppressed, hasSink]) flag.removeListener(id);
    };
  }, [ctx]);
  if (!ctx) return null;
  return (
    <div
      ref={overlayRef}
      className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center opacity-0 transition-opacity duration-150"
    >
      <div className="absolute inset-0 bg-background opacity-70" />
      <div className="relative flex flex-col items-center gap-2">
        <Upload size={32} className="text-primary" />
        <span className="text-sm font-medium text-foreground">
          {t("composer.attachments.dropFilesHere")}
        </span>
      </div>
    </div>
  );
}

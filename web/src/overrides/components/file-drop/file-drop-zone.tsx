// Override of packages/app/src/components/file-drop/file-drop-zone.tsx: a drag-and-drop area with
// its dim backdrop. Files go to whichever descendant registered with `useFileDrop`; drag state
// lives in flags outside React so a drag never re-renders the tree.
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { FileDropContext, type FileDropContextValue } from "@/components/file-drop/context";
import { FileDropBackdrop } from "@/components/file-drop/file-drop-backdrop";
import type { FileDropSink } from "@/components/file-drop/types";
import { useDropListeners } from "@/components/file-drop/use-drop-listeners";
import { cn } from "cn";
import { createSharedFlag } from "~/lib/shared-flag";

export function FileDropZone({
  children,
  disabled = false,
  className,
}: {
  children: ReactNode;
  /** When true, no drops are accepted and the backdrop stays hidden. */
  disabled?: boolean;
  /** Sizes the drop area; the backdrop fills it. */
  className?: string;
}) {
  const [isDragging] = useState(() => createSharedFlag(false));
  const [suppressed] = useState(() => createSharedFlag(false));
  const [hasSink] = useState(() => createSharedFlag(false));
  const activeGetSink = useRef<(() => FileDropSink | null) | null>(null);
  const registerSink = useCallback(
    (getSink: () => FileDropSink | null) => {
      activeGetSink.current = getSink;
      hasSink.value = true;
      return () => {
        if (activeGetSink.current === getSink) {
          activeGetSink.current = null;
          hasSink.value = false;
        }
      };
    },
    [hasSink],
  );
  const getSink = useCallback(() => activeGetSink.current?.() ?? null, []);
  const ctx = useMemo<FileDropContextValue>(
    () => ({ isDragging, suppressed, hasSink, registerSink }),
    [isDragging, suppressed, hasSink, registerSink],
  );
  const containerRef = useDropListeners({ isDragging, suppressed, hasSink, getSink, disabled });
  return (
    <FileDropContext value={ctx}>
      <div
        ref={containerRef as React.RefObject<HTMLDivElement | null>}
        className={cn("relative", className)}
      >
        {children}
        <FileDropBackdrop />
      </div>
    </FileDropContext>
  );
}

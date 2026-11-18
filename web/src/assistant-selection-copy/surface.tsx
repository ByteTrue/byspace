// Port of archive/expo-app:packages/app/src/assistant-selection-copy/surface.web.tsx: copying a selection out
// of the conversation writes markdown and HTML, rebuilt from the rendered rows' copy markers.
import { useCallback, type ClipboardEvent, type ReactNode } from "react";
import { createAssistantSelectionClipboardContent } from "@/assistant-selection-copy/content";
import { cn } from "cn";

export function AssistantSelectionCopySurface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const content = createAssistantSelectionClipboardContent(window.getSelection());
    if (!content) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", content.plainText);
    event.clipboardData.setData("text/html", content.html);
  }, []);
  return (
    <div onCopy={handleCopy} className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      {children}
    </div>
  );
}

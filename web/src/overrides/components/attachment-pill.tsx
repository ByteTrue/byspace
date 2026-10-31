// Override of packages/app/src/components/attachment-pill.tsx: attachment chips, 48px tall so a
// mixed tray lines up; the composer's has a remove button that shows on hover (always on a phone).
import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { cn } from "cn";

const FRAME = "overflow-hidden rounded-md border border-input";

export function AttachmentPill({
  onOpen,
  onRemove,
  openAccessibilityLabel,
  removeAccessibilityLabel,
  disabled = false,
  testID,
  children,
}: {
  onOpen: () => void;
  onRemove: () => void;
  openAccessibilityLabel: string;
  removeAccessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <div className="group/attachment relative">
      <button
        type="button"
        data-testid={testID}
        onClick={onOpen}
        disabled={disabled}
        aria-label={openAccessibilityLabel}
        className={cn(FRAME, "block")}
      >
        {children}
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={removeAccessibilityLabel}
        className="absolute -top-2 -left-2 z-[1] flex size-6 items-center justify-center rounded-full border bg-muted text-muted-foreground opacity-0 group-hover/attachment:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** Bare attachment frame for read-only surfaces (sent messages) — no remove button. */
export function AttachmentFrame({
  onPress,
  accessibilityLabel,
  testID,
  children,
}: {
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  children: ReactNode;
}) {
  if (!onPress) {
    return (
      <div data-testid={testID} className={FRAME}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid={testID}
      onClick={onPress}
      aria-label={accessibilityLabel}
      className={cn(FRAME, "block")}
    >
      {children}
    </button>
  );
}

/** Two-line labelled pill body: attachment name over its type. */
export function AttachmentLabel({
  icon,
  title,
  subtitle,
}: {
  icon?: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex h-12 max-w-[260px] items-center gap-2 bg-card px-3 text-left">
      {icon ? <div className="flex w-[18px] items-center justify-center">{icon}</div> : null}
      <div className="flex min-w-0 shrink flex-col">
        <span className="truncate text-sm text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
      </div>
    </div>
  );
}

/** Square image preview pill body. */
export function AttachmentThumbnail({ metadata }: { metadata: AttachmentMetadata }) {
  const uri = useAttachmentPreviewUrl(metadata);
  if (!uri) return <div className="size-12 bg-card" />;
  return <img src={uri} alt="" className="size-12 object-cover" />;
}

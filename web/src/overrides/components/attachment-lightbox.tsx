// Override of packages/app/src/components/attachment-lightbox.tsx: an image over the whole window
// on a dark backdrop, zoomable, closed by Escape, the close action or a click outside it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import type { ViewportSize } from "@/components/zoomable-viewport/geometry";
import { ZoomableImage } from "@/components/zoomable-viewport/image";
import { SPACING } from "@/styles/theme";

export type ImageLightboxSource =
  | { type: "attachment"; metadata: AttachmentMetadata }
  | { type: "uri"; uri: string; contentSize?: ViewportSize };

const LIGHTBOX_FIT = { padding: SPACING[4], maxWidth: 960, maxHeight: 640 };

export function AttachmentLightbox({
  source,
  onClose,
}: {
  source: ImageLightboxSource | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const metadata = source?.type === "attachment" ? source.metadata : null;
  const attachmentUrl = useAttachmentPreviewUrl(metadata);
  const url = source?.type === "uri" ? source.uri : attachmentUrl;
  const contentSize = source?.type === "uri" ? source.contentSize : undefined;
  const [errored, setErrored] = useState(false);
  const layerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setErrored(false);
  }, [metadata?.id, url]);
  const open = source !== null;
  useEffect(() => {
    if (!open) return;
    layerRef.current?.focus();
    function handleKeydown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  }, [onClose, open]);
  const actions = useMemo(
    () => [
      {
        icon: X,
        label: t("message.attachments.closeImage"),
        onPress: onClose,
        testID: "attachment-lightbox-close",
      },
    ],
    [onClose, t],
  );
  const handleImageError = useCallback(() => setErrored(true), []);
  if (!source) return null;
  const hasError = errored || !url;
  return createPortal(
    <div
      ref={layerRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 outline-none"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        data-testid="attachment-lightbox-backdrop"
        aria-label={t("message.attachments.dismissImage")}
        onClick={onClose}
        className="absolute inset-0 bg-black/90"
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {hasError ? (
          <span className="text-sm text-muted-foreground">
            {t("message.attachments.imageLoadFailed")}
          </span>
        ) : (
          <ZoomableImage
            accessibilityLabel={t("composer.attachments.openImage")}
            actions={actions}
            contentSize={contentSize}
            fit={LIGHTBOX_FIT}
            onError={handleImageError}
            onPressOutsideContent={onClose}
            className="pointer-events-auto w-full flex-1 self-center"
            testID="attachment-lightbox"
            uri={url}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

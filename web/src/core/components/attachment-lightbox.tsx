// An image over the whole window: a full-screen shadcn Dialog on a dark fill, zoomable, closed by
// Escape, the close action or a click outside the image.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
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
  useEffect(() => {
    setErrored(false);
  }, [metadata?.id, url]);
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
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const hasError = errored || !url;
  return (
    <Dialog open={source !== null} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="fixed inset-0 top-0 left-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col rounded-none p-0 ring-0 sm:max-w-none items-center justify-center bg-black/90 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
      >
        <DialogTitle className="sr-only">{t("composer.attachments.openImage")}</DialogTitle>
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
            className="w-full flex-1 self-center"
            testID="attachment-lightbox"
            uri={url}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Port of archive/expo-app:packages/app/src/components/add-host-method-modal.tsx: how to add a host: direct connection or a pasted pairing link; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/add-host-modals.py; edit it directly.
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link2, ClipboardPaste } from "lucide-react";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";

import type { Theme } from "@/styles/theme";
import { withTheme } from "~/app/theme-object";
import { Item } from "~/components/ui/item";

const ThemedLink2 = withTheme(Link2);
const ThemedClipboardPaste = withTheme(ClipboardPaste);
const foregroundIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export interface AddHostMethodModalProps {
  visible: boolean;
  onClose: () => void;
  onDirectConnection: () => void;
  onRemoteSsh: () => void;
  onPasteLink: () => void;
}

export function AddHostMethodModal({
  visible,
  onClose,
  onDirectConnection,
  onPasteLink,
}: AddHostMethodModalProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.connectionMethods.title") }), [t]);

  const handleDirect = useCallback(() => {
    onDirectConnection();
  }, [onDirectConnection]);

  const handlePaste = useCallback(() => {
    onPasteLink();
  }, [onPasteLink]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="add-host-method-modal"
    >
      <Item variant="outline" asChild className="text-left">
        <button
          type="button"
          onClick={handleDirect}
          aria-label={t("pairing.connectionMethods.direct.title")}
          data-testid="add-host-method-direct"
          className="hover:bg-muted"
        >
          <ThemedLink2 size={18} themeProps={foregroundIconMapping} />
          <span className="flex flex-1 flex-col">
            <span className="text-sm leading-[normal] font-normal text-foreground">
              {t("pairing.connectionMethods.direct.title")}
            </span>
            <span className="mt-1 text-sm leading-[normal] text-muted-foreground">
              {t("pairing.connectionMethods.direct.description")}
            </span>
          </span>
        </button>
      </Item>

      <Item variant="outline" asChild className="text-left">
        <button
          type="button"
          onClick={handlePaste}
          aria-label={t("pairing.connectionMethods.pasteLink.title")}
          data-testid="add-host-method-pair-link"
          className="hover:bg-muted"
        >
          <ThemedClipboardPaste size={18} themeProps={foregroundIconMapping} />
          <span className="flex flex-1 flex-col">
            <span className="text-sm leading-[normal] font-normal text-foreground">
              {t("pairing.connectionMethods.pasteLink.title")}
            </span>
            <span className="mt-1 text-sm leading-[normal] text-muted-foreground">
              {t("pairing.connectionMethods.pasteLink.description")}
            </span>
          </span>
        </button>
      </Item>
    </AdaptiveModalSheet>
  );
}

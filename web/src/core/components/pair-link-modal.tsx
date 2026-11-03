// Port of archive/expo-app:packages/app/src/components/pair-link-modal.tsx: the paste-a-pairing-link form; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/add-host-modals.py; edit it directly.
import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "lucide-react";
import type { HostProfile } from "@/types/host-connection";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import { pairWithOfferUrl, parsePairingOfferUrl } from "@/utils/pair-offer";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "~/components/ui/button";
import { useThemeObject } from "~/app/theme-object";
import { Input } from "~/components/ui/input";

export interface PairLinkModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

export function PairLinkModal({ visible, onClose, onCancel, onSaved }: PairLinkModalProps) {
  const theme = useThemeObject();
  const { t } = useTranslation();
  const daemons = useHosts();
  const { upsertConnectionFromOfferUrl: upsertDaemonFromOfferUrl } = useHostMutations();

  const offerUrlRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const clearInput = useCallback(() => {
    offerUrlRef.current = "";
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const pairIcon = useMemo(
    () => <Link size={16} color={theme.colors.accentForeground} />,
    [theme.colors.accentForeground],
  );

  const handleClose = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    onClose();
  }, [isSaving, clearInput, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    (onCancel ?? onClose)();
  }, [isSaving, clearInput, onCancel, onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const raw = offerUrlRef.current.trim();
    const parsed = parsePairingOfferUrl(raw);
    if (!parsed.ok) {
      const message = t(`pairing.link.errors.${parsed.errorKey}`);
      setErrorMessage(message);
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage("");

      const { profile, hostname, isNewHost } = await pairWithOfferUrl({
        rawUrl: raw,
        offer: parsed.offer,
        knownServerIds: daemons.map((daemon) => daemon.serverId),
        upsert: upsertDaemonFromOfferUrl,
      });
      onSaved?.({ profile, serverId: parsed.offer.serverId, hostname, isNewHost });
      handleClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("pairing.link.errors.unableToPair");
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  }, [daemons, handleClose, isSaving, onSaved, t, upsertDaemonFromOfferUrl]);

  const handleChangeOfferUrl = useCallback((next: string) => {
    offerUrlRef.current = next;
  }, []);
  const handleChangeOfferUrlInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => handleChangeOfferUrl(event.target.value),
    [handleChangeOfferUrl],
  );

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.link.title") }), [t]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="pair-link-modal"
    >
      <span className="text-sm leading-[normal] text-muted-foreground">
        {t("pairing.link.helper")}
      </span>

      <div className="flex flex-col gap-2">
        <span className="text-sm leading-[normal] font-medium text-muted-foreground">
          {t("pairing.link.label")}
        </span>
        <Input
          ref={inputRef}
          data-testid="pair-link-input"
          aria-label={t("pairing.link.label")}
          onChange={handleChangeOfferUrlInput}
          placeholder="https://app.byspace.cc.cd/#offer=..."
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="url"
        />
        {errorMessage ? (
          <span className="whitespace-pre-line text-sm leading-[normal] text-destructive">
            {errorMessage}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-row gap-3">
        <Button
          className="flex-1"
          variant="secondary"
          onClick={handleCancel}
          data-testid="pair-link-cancel"
          aria-label={t("pairing.link.actions.cancel")}
          disabled={isSaving}
        >
          {t("pairing.link.actions.cancel")}
        </Button>
        <Button
          className="flex-1"
          variant="default"
          onClick={handleSavePress}
          data-testid="pair-link-submit"
          aria-label={t("pairing.link.actions.pair")}
          disabled={isSaving}
        >
          {pairIcon}
          {isSaving ? t("pairing.link.actions.pairing") : t("pairing.link.actions.pair")}
        </Button>
      </div>
    </AdaptiveModalSheet>
  );
}

// Port of archive/expo-app:packages/app/src/components/setup-guide-modal.tsx: the setup guide sheet; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/welcome-screen.py; edit it directly.
import { CodeBlock, CodeBlockContent, CodeBlockFooter } from "~/components/ui/code-block";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardPaste, Copy } from "lucide-react";
import * as Clipboard from "~/lib/clipboard";
import { useToast } from "@/contexts/toast-context";
import type { HostProfile } from "@/types/host-connection";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import { buildSetupCommands } from "@/utils/setup-commands";
import { pairWithOfferUrl, parsePairingOfferUrl } from "@/utils/pair-offer";
import { readStoredRelayEndpoint, storeRelayEndpoint } from "@/utils/setup-guide-storage";
import { isBySpaceHostedAppBaseUrl } from "@bytetrue/protocol/release-channel";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

interface CommandBlockProps {
  command: string;
  copyLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
  testID: string;
}

function CommandBlock({
  command,
  copyLabel,
  copiedLabel,
  copyFailedLabel,
  testID,
}: CommandBlockProps) {
  const toast = useToast();
  const handleCopyPress = useCallback(() => {
    void Clipboard.writeText(command)
      .then(() => toast.copied(copiedLabel))
      .catch(() => toast.error(copyFailedLabel));
  }, [command, copyFailedLabel, copiedLabel, toast]);
  return (
    <CodeBlock data-testid={testID}>
      <CodeBlockContent>{command}</CodeBlockContent>
      <CodeBlockFooter>
        <Button variant="ghost" size="sm" onClick={handleCopyPress}>
          <Copy data-icon="inline-start" />
          {copyLabel}
        </Button>
      </CodeBlockFooter>
    </CodeBlock>
  );
}

export interface SetupGuideModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

export function SetupGuideModal({ visible, onClose, onSaved }: SetupGuideModalProps) {
  const { t } = useTranslation();
  const daemons = useHosts();
  const { upsertConnectionFromOfferUrl: upsertDaemonFromOfferUrl, upsertRelayConnection } =
    useHostMutations();

  const [relayEndpoint, setRelayEndpoint] = useState("");
  // The daemon password. Relay is the path that needs one (loopback and SSH do not), and the
  // offering link never carries it, so this is where the user supplies it.
  const [daemonPassword, setDaemonPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const offerUrlRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const relayInputRef = useRef<HTMLInputElement>(null);

  // Web-only API: read inside component scope, never at module scope.
  const webOrigin =
    typeof window !== "undefined" &&
    window.location &&
    !isBySpaceHostedAppBaseUrl(window.location.origin)
      ? window.location.origin
      : null;
  const isSelfHosted = webOrigin !== null;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      const stored = await readStoredRelayEndpoint();
      if (!cancelled) setRelayEndpoint(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const commands = useMemo(
    () => buildSetupCommands({ webOrigin, relayEndpoint: relayEndpoint.trim() }),
    [webOrigin, relayEndpoint],
  );

  const pairIcon = useMemo(() => <ClipboardPaste size={16} className="size-4" />, []);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setErrorMessage("");
    onClose();
  }, [isSaving, onClose]);

  const handleRelayEndpointChange = useCallback((next: string) => {
    setRelayEndpoint(next);
    void storeRelayEndpoint(next);
  }, []);
  const handleRelayEndpointInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => handleRelayEndpointChange(event.target.value),
    [handleRelayEndpointChange],
  );

  const handleChangePairingLink = useCallback((next: string) => {
    offerUrlRef.current = next;
  }, []);
  const handleChangePairingLinkInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => handleChangePairingLink(event.target.value),
    [handleChangePairingLink],
  );

  const showError = useCallback((message: string) => {
    setErrorMessage(message);
  }, []);

  const handleChangeDaemonPassword = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDaemonPassword(event.target.value);
  }, []);

  const handlePair = useCallback(async () => {
    if (isSaving) return;
    const raw = offerUrlRef.current.trim();
    const parsed = parsePairingOfferUrl(raw);
    if (!parsed.ok) {
      showError(t(`pairing.link.errors.${parsed.errorKey}`));
      return;
    }
    try {
      setIsSaving(true);
      setErrorMessage("");
      const password = daemonPassword.trim();
      const { profile, hostname, isNewHost } = await pairWithOfferUrl({
        rawUrl: raw,
        offer: parsed.offer,
        knownServerIds: daemons.map((daemon) => daemon.serverId),
        upsert: upsertDaemonFromOfferUrl,
        ...(password ? { daemonPassword: password } : {}),
      });
      if (password) {
        // Stored on this device only, on the relay connection it belongs to. The probe above used it
        // once; the connected host needs it for every later reconnect.
        await upsertRelayConnection({
          serverId: parsed.offer.serverId,
          relayEndpoint:
            profile.connections.find((entry) => entry.type === "relay")?.relayEndpoint ?? "",
          useTls: parsed.offer.relay.useTls,
          daemonPublicKeyB64: parsed.offer.daemonPublicKeyB64,
          password: password,
        }).catch(() => undefined);
      }
      onSaved?.({ profile, serverId: parsed.offer.serverId, hostname, isNewHost });
      handleClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("pairing.link.errors.unableToPair");
      showError(message);
    } finally {
      setIsSaving(false);
    }
  }, [
    daemonPassword,
    daemons,
    handleClose,
    isSaving,
    onSaved,
    showError,
    t,
    upsertDaemonFromOfferUrl,
    upsertRelayConnection,
  ]);

  const handlePairPress = useCallback(() => {
    void handlePair();
  }, [handlePair]);

  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.setupGuide.title") }), [t]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="setup-guide-modal"
    >
      <div className="flex flex-col gap-2">
        <span className={STEP_TITLE}>{t("pairing.setupGuide.steps.install")}</span>
        <CommandBlock
          command={commands.installCommand}
          copyLabel={t("pairing.setupGuide.actions.copy")}
          copiedLabel={t("pairing.setupGuide.actions.copied")}
          copyFailedLabel={t("pairing.setupGuide.actions.copyFailed")}
          testID="setup-guide-install-command"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className={STEP_TITLE}>{t("pairing.setupGuide.steps.onboard")}</span>
        <span className={MUTED_TEXT}>
          {isSelfHosted
            ? t("pairing.setupGuide.descriptions.onboard")
            : t("pairing.setupGuide.descriptions.onboardHosted")}
        </span>
        {isSelfHosted ? (
          <div className="flex flex-col gap-2">
            <span className={FIELD_LABEL}>{t("pairing.setupGuide.fields.relayEndpoint")}</span>
            <Input
              ref={relayInputRef}
              defaultValue={relayEndpoint}
              key={relayEndpoint}
              onChange={handleRelayEndpointInput}
              placeholder={t("pairing.setupGuide.fields.relayEndpointPlaceholder")}
              data-testid="setup-guide-relay-endpoint-input"
              aria-label={t("pairing.setupGuide.fields.relayEndpoint")}
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="url"
            />
            <span className={MUTED_TEXT}>{t("pairing.setupGuide.fields.relayEndpointHelper")}</span>
          </div>
        ) : null}
        <CommandBlock
          command={commands.onboardCommand}
          copyLabel={t("pairing.setupGuide.actions.copy")}
          copiedLabel={t("pairing.setupGuide.actions.copied")}
          copyFailedLabel={t("pairing.setupGuide.actions.copyFailed")}
          testID="setup-guide-onboard-command"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className={STEP_TITLE}>{t("pairing.setupGuide.steps.pair")}</span>
        <span className={MUTED_TEXT}>{t("pairing.setupGuide.descriptions.pair")}</span>
        <div className="flex flex-col gap-2">
          <span className={FIELD_LABEL}>{t("pairing.setupGuide.fields.pairingLink")}</span>
          <Input
            ref={inputRef}
            onChange={handleChangePairingLinkInput}
            placeholder="https://…/#offer=…"
            data-testid="setup-guide-pairing-link-input"
            aria-label={t("pairing.setupGuide.fields.pairingLink")}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
          />
          <span className={FIELD_LABEL}>{t("pairing.setupGuide.fields.daemonPassword")}</span>
          <Input
            type="password"
            onChange={handleChangeDaemonPassword}
            placeholder={t("pairing.setupGuide.fields.daemonPasswordPlaceholder")}
            data-testid="setup-guide-daemon-password-input"
            aria-label={t("pairing.setupGuide.fields.daemonPassword")}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <span className={MUTED_TEXT}>{t("pairing.setupGuide.fields.daemonPasswordHelper")}</span>
          {errorMessage ? (
            <span className="text-sm leading-[normal] text-destructive">{errorMessage}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-row gap-3">
        <Button
          className="flex-1"
          variant="secondary"
          onClick={handleClose}
          data-testid="setup-guide-cancel"
          aria-label={t("pairing.setupGuide.actions.cancel")}
          disabled={isSaving}
        >
          {t("pairing.setupGuide.actions.cancel")}
        </Button>
        <Button
          className="flex-1"
          variant="default"
          onClick={handlePairPress}
          data-testid="setup-guide-submit"
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

const STEP_TITLE = "text-sm leading-[normal] font-medium text-foreground";
const MUTED_TEXT = "text-sm leading-[normal] text-muted-foreground";
const FIELD_LABEL = "text-sm leading-[normal] font-medium text-muted-foreground";

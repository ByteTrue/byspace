import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { ClipboardPaste, Copy } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import type { HostProfile } from "@/types/host-connection";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import { buildSetupCommands } from "@/utils/setup-commands";
import { pairWithOfferUrl, parsePairingOfferUrl } from "@/utils/pair-offer";
import { readStoredRelayEndpoint, storeRelayEndpoint } from "@/utils/setup-guide-storage";
import { isBySpaceHostedAppBaseUrl } from "@bytetrue/protocol/release-channel";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";

const FLEX_ONE_STYLE = { flex: 1 } as const;

const styles = StyleSheet.create((theme) => ({
  step: {
    gap: theme.spacing[2],
  },
  stepTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  stepText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  command: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  commandText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.base,
  },
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

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
    void Clipboard.setStringAsync(command)
      .then(() => toast.copied(copiedLabel))
      .catch(() => toast.error(copyFailedLabel));
  }, [command, copyFailedLabel, copiedLabel, toast]);
  const copyIcon = useMemo(
    () => <Copy size={16} color={UnistylesRuntime.getTheme().colors.foregroundMuted} />,
    [],
  );
  return (
    <View style={styles.command} testID={testID}>
      <Text selectable dataSet={CODE_SURFACE_DATASET} style={styles.commandText}>
        {command}
      </Text>
      <Button variant="ghost" size="sm" leftIcon={copyIcon} onPress={handleCopyPress}>
        {copyLabel}
      </Button>
    </View>
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
  const { upsertConnectionFromOfferUrl: upsertDaemonFromOfferUrl } = useHostMutations();
  const isMobile = useIsCompactFormFactor();

  const [relayEndpoint, setRelayEndpoint] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const offerUrlRef = useRef("");
  const inputRef = useRef<EditingTextInputHandle>(null);
  const relayInputRef = useRef<EditingTextInputHandle>(null);

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

  const pairIcon = useMemo(
    () => <ClipboardPaste size={16} color={UnistylesRuntime.getTheme().colors.accentForeground} />,
    [],
  );

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setErrorMessage("");
    onClose();
  }, [isSaving, onClose]);

  const handleRelayEndpointChange = useCallback((next: string) => {
    setRelayEndpoint(next);
    void storeRelayEndpoint(next);
  }, []);

  const handleChangePairingLink = useCallback((next: string) => {
    offerUrlRef.current = next;
  }, []);

  const showError = useCallback(
    (message: string) => {
      setErrorMessage(message);
      if (!isMobile) {
        Alert.alert(t("pairing.link.alert.failedTitle"), message);
      }
    },
    [isMobile, t],
  );

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
      showError(message);
    } finally {
      setIsSaving(false);
    }
  }, [daemons, handleClose, isSaving, onSaved, showError, t, upsertDaemonFromOfferUrl]);

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
      <View style={styles.step}>
        <Text style={styles.stepTitle}>{t("pairing.setupGuide.steps.install")}</Text>
        <CommandBlock
          command={commands.installCommand}
          copyLabel={t("pairing.setupGuide.actions.copy")}
          copiedLabel={t("pairing.setupGuide.actions.copied")}
          copyFailedLabel={t("pairing.setupGuide.actions.copyFailed")}
          testID="setup-guide-install-command"
        />
      </View>

      <View style={styles.step}>
        <Text style={styles.stepTitle}>{t("pairing.setupGuide.steps.onboard")}</Text>
        <Text style={styles.stepText}>
          {isSelfHosted
            ? t("pairing.setupGuide.descriptions.onboard")
            : t("pairing.setupGuide.descriptions.onboardHosted")}
        </Text>
        {isSelfHosted ? (
          <View style={styles.field}>
            <Text style={styles.label}>{t("pairing.setupGuide.fields.relayEndpoint")}</Text>
            <AdaptiveTextInput
              ref={relayInputRef}
              initialValue={relayEndpoint}
              resetKey={relayEndpoint}
              onChangeText={handleRelayEndpointChange}
              placeholder={t("pairing.setupGuide.fields.relayEndpointPlaceholder")}
              placeholderTextColor={UnistylesRuntime.getTheme().colors.foregroundMuted}
              style={styles.input}
              testID="setup-guide-relay-endpoint-input"
              nativeID="setup-guide-relay-endpoint-input"
              accessibilityLabel={t("pairing.setupGuide.fields.relayEndpoint")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.helper}>{t("pairing.setupGuide.fields.relayEndpointHelper")}</Text>
          </View>
        ) : null}
        <CommandBlock
          command={commands.onboardCommand}
          copyLabel={t("pairing.setupGuide.actions.copy")}
          copiedLabel={t("pairing.setupGuide.actions.copied")}
          copyFailedLabel={t("pairing.setupGuide.actions.copyFailed")}
          testID="setup-guide-onboard-command"
        />
      </View>

      <View style={styles.step}>
        <Text style={styles.stepTitle}>{t("pairing.setupGuide.steps.pair")}</Text>
        <Text style={styles.stepText}>{t("pairing.setupGuide.descriptions.pair")}</Text>
        <View style={styles.field}>
          <Text style={styles.label}>{t("pairing.setupGuide.fields.pairingLink")}</Text>
          <AdaptiveTextInput
            ref={inputRef}
            onChangeText={handleChangePairingLink}
            placeholder="https://…/#offer=…"
            placeholderTextColor={UnistylesRuntime.getTheme().colors.foregroundMuted}
            style={styles.input}
            testID="setup-guide-pairing-link-input"
            nativeID="setup-guide-pairing-link-input"
            accessibilityLabel={t("pairing.setupGuide.fields.pairingLink")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleClose}
          disabled={isSaving}
          testID="setup-guide-cancel"
          accessibilityRole="button"
          accessibilityLabel={t("pairing.setupGuide.actions.cancel")}
        >
          {t("pairing.setupGuide.actions.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant="default"
          onPress={handlePairPress}
          disabled={isSaving}
          testID="setup-guide-submit"
          accessibilityRole="button"
          accessibilityLabel={t("pairing.link.actions.pair")}
          leftIcon={pairIcon}
        >
          {isSaving ? t("pairing.link.actions.pairing") : t("pairing.link.actions.pair")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

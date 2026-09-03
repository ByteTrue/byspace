import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Eye, EyeOff, Terminal } from "lucide-react-native";
import { parseSshTransportUri } from "@getpaseo/protocol/ssh-transport";
import type { HostProfile } from "@/types/host-connection";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";
import { normalizeSshTargetInput } from "@/utils/ssh-target-input";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";

const FLEX_ONE_STYLE = { flex: 1 } as const;
const ThemedTerminal = withUnistyles(Terminal);
const ThemedEye = withUnistyles(Eye, (theme) => ({
  size: 18,
  color: theme.colors.foregroundMuted,
}));
const ThemedEyeOff = withUnistyles(EyeOff, (theme) => ({
  size: 18,
  color: theme.colors.foregroundMuted,
}));

const styles = StyleSheet.create((theme) => ({
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  passwordInputWrap: {
    flex: 1,
    minWidth: 0,
  },
  iconButton: {
    aspectRatio: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

export interface AddRemoteSshHostModalProps {
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

export function AddRemoteSshHostModal({
  visible,
  onClose,
  onCancel,
  onSaved,
}: AddRemoteSshHostModalProps) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const isCompact = useIsCompactFormFactor();
  const { probeAndUpsertRemoteSshConnection } = useHostMutations();
  const targetRef = useRef("");
  const passwordRef = useRef("");
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.remoteSsh.title") }), [t]);

  const clear = useCallback(() => {
    targetRef.current = "";
    passwordRef.current = "";
    inputRef.current?.replaceText("");
    setErrorMessage("");
    setIsPasswordVisible(false);
  }, []);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    clear();
    onClose();
  }, [clear, isSaving, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    clear();
    (onCancel ?? onClose)();
  }, [clear, isSaving, onCancel, onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const rawTarget = targetRef.current.trim();
    if (!rawTarget) {
      setErrorMessage(t("pairing.remoteSsh.errors.targetRequired"));
      return;
    }

    let target: ReturnType<typeof parseSshTransportUri>;
    try {
      target = parseSshTransportUri(normalizeSshTargetInput(rawTarget));
    } catch {
      setErrorMessage(t("pairing.remoteSsh.errors.invalidTarget"));
      return;
    }

    let result: Awaited<ReturnType<typeof probeAndUpsertRemoteSshConnection>>;
    try {
      setIsSaving(true);
      setErrorMessage("");
      const password = passwordRef.current.trim();
      result = await probeAndUpsertRemoteSshConnection({
        ...target,
        ...(password ? { password } : {}),
      });
    } catch (error) {
      const message =
        error instanceof DaemonConnectionTestError
          ? t("pairing.remoteSsh.errors.failedToConnect", { detail: error.message })
          : t("common.errors.unableToSave");
      setErrorMessage(message);
      return;
    } finally {
      setIsSaving(false);
    }

    clear();
    onClose();
    onSaved?.({
      ...result,
      isNewHost: !hosts.some((profile) => profile.serverId === result.serverId),
    });
  }, [clear, hosts, isSaving, onClose, onSaved, probeAndUpsertRemoteSshConnection, t]);
  const handleTargetChange = useCallback((value: string) => {
    targetRef.current = value;
  }, []);
  const handlePasswordChange = useCallback((value: string) => {
    passwordRef.current = value;
  }, []);
  const handleTogglePasswordVisibility = useCallback(() => {
    setIsPasswordVisible((previous) => !previous);
  }, []);
  const handleSubmit = useCallback(() => void handleSave(), [handleSave]);

  const PasswordVisibilityIcon = isPasswordVisible ? ThemedEyeOff : ThemedEye;

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="add-remote-ssh-host-modal"
    >
      <Text style={styles.helper}>{t("pairing.remoteSsh.helper")}</Text>
      <Field
        label={t("pairing.remoteSsh.fields.target")}
        error={errorMessage}
        testID="remote-ssh-target"
      >
        <FormTextInput
          ref={inputRef}
          size={isCompact ? "md" : "sm"}
          testID="remote-ssh-target-input"
          accessibilityLabel={t("pairing.remoteSsh.fields.target")}
          initialValue=""
          onChangeText={handleTargetChange}
          placeholder="user@host"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSaving}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
      </Field>
      <Field label={t("pairing.remoteSsh.fields.password")} testID="remote-ssh-password">
        <View style={styles.passwordRow}>
          <View style={styles.passwordInputWrap}>
            <FormTextInput
              size={isCompact ? "md" : "sm"}
              testID="remote-ssh-password-input"
              accessibilityLabel={t("pairing.remoteSsh.fields.password")}
              initialValue=""
              onChangeText={handlePasswordChange}
              placeholder={t("pairing.remoteSsh.fields.passwordOptional")}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!isPasswordVisible}
              editable={!isSaving}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          </View>
          <Pressable
            style={styles.iconButton}
            onPress={handleTogglePasswordVisibility}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={
              isPasswordVisible
                ? t("pairing.remoteSsh.passwordVisibility.hide")
                : t("pairing.remoteSsh.passwordVisibility.show")
            }
            testID="remote-ssh-password-visibility-toggle"
          >
            <PasswordVisibilityIcon />
          </Pressable>
        </View>
      </Field>
      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleCancel}
          disabled={isSaving}
        >
          {t("pairing.remoteSsh.actions.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          onPress={handleSubmit}
          disabled={isSaving}
          leftIcon={ThemedTerminal}
          testID="remote-ssh-submit"
        >
          {isSaving
            ? t("pairing.remoteSsh.actions.connecting")
            : t("pairing.remoteSsh.actions.connect")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

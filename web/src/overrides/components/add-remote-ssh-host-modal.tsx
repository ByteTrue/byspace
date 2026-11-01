// Override of packages/app/src/components/add-remote-ssh-host-modal.tsx: the remote SSH host form; DOM view.
// Generated from the Expo file by web/scripts/port/add-host-modals.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { Eye, EyeOff, Terminal } from "lucide-react";
import { parseSshTransportUri } from "@bytetrue/protocol/ssh-transport";
import type { HostProfile } from "@/types/host-connection";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";
import { normalizeSshTargetInput } from "@/utils/ssh-target-input";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";

const ThemedEye = withUnistyles(Eye, (theme) => ({
  size: 18,
  color: theme.colors.foregroundMuted,
}));
const ThemedEyeOff = withUnistyles(EyeOff, (theme) => ({
  size: 18,
  color: theme.colors.foregroundMuted,
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
      <span className="text-xs leading-[normal] text-muted-foreground">
        {t("pairing.remoteSsh.helper")}
      </span>
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
          enterKeyHint="done"
          onSubmitEditing={handleSubmit}
        />
      </Field>
      <Field label={t("pairing.remoteSsh.fields.password")} testID="remote-ssh-password">
        <div className="flex flex-row items-center gap-2">
          <div className="min-w-0 flex-1">
            <FormTextInput
              size={isCompact ? "md" : "sm"}
              testID="remote-ssh-password-input"
              accessibilityLabel={t("pairing.remoteSsh.fields.password")}
              initialValue=""
              onChangeText={handlePasswordChange}
              placeholder={t("pairing.remoteSsh.fields.passwordOptional")}
              autoCapitalize="none"
              autoCorrect={false}
              type={isPasswordVisible ? "text" : "password"}
              editable={!isSaving}
              enterKeyHint="done"
              onSubmitEditing={handleSubmit}
            />
          </div>
          <button
            type="button"
            className="flex aspect-square shrink-0 items-center justify-center self-stretch rounded-lg border bg-muted"
            onClick={handleTogglePasswordVisibility}
            disabled={isSaving}
            aria-label={
              isPasswordVisible
                ? t("pairing.remoteSsh.passwordVisibility.hide")
                : t("pairing.remoteSsh.passwordVisibility.show")
            }
            data-testid="remote-ssh-password-visibility-toggle"
          >
            <PasswordVisibilityIcon />
          </button>
        </div>
      </Field>
      <div className="mt-2 flex flex-row gap-3">
        <Button className="flex-1" variant="secondary" onPress={handleCancel} disabled={isSaving}>
          {t("pairing.remoteSsh.actions.cancel")}
        </Button>
        <Button
          className="flex-1"
          onPress={handleSubmit}
          disabled={isSaving}
          leftIcon={Terminal}
          testID="remote-ssh-submit"
        >
          {isSaving
            ? t("pairing.remoteSsh.actions.connecting")
            : t("pairing.remoteSsh.actions.connect")}
        </Button>
      </div>
    </AdaptiveModalSheet>
  );
}

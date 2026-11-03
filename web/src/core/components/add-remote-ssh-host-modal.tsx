// Port of archive/expo-app:packages/app/src/components/add-remote-ssh-host-modal.tsx: the remote SSH host form; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/add-host-modals.py; edit it directly.
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Terminal } from "lucide-react";
import { parseSshTransportUri } from "@bytetrue/protocol/ssh-transport";
import type { HostProfile } from "@/types/host-connection";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { Button } from "~/components/ui/button";
import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";
import { normalizeSshTargetInput } from "@/utils/ssh-target-input";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { withTheme } from "~/app/theme-object";
import { Input } from "~/components/ui/input";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";

const ThemedEye = withTheme(Eye, (theme) => ({
  size: 18,
  color: theme.colors.foregroundMuted,
}));
const ThemedEyeOff = withTheme(EyeOff, (theme) => ({
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
  const { probeAndUpsertRemoteSshConnection } = useHostMutations();
  const targetRef = useRef("");
  const passwordRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.remoteSsh.title") }), [t]);

  const clear = useCallback(() => {
    targetRef.current = "";
    passwordRef.current = "";
    if (inputRef.current) inputRef.current.value = "";
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
  const handleTargetInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => handleTargetChange(event.target.value),
    [handleTargetChange],
  );
  const handlePasswordChange = useCallback((value: string) => {
    passwordRef.current = value;
  }, []);
  const handlePasswordInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => handlePasswordChange(event.target.value),
    [handlePasswordChange],
  );
  const handleTogglePasswordVisibility = useCallback(() => {
    setIsPasswordVisible((previous) => !previous);
  }, []);
  const handleSubmit = useCallback(() => void handleSave(), [handleSave]);
  const handleSubmitEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) handleSubmit();
    },
    [handleSubmit],
  );

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
      <Field data-testid="remote-ssh-target" data-invalid={Boolean(errorMessage)}>
        <FieldLabel>{t("pairing.remoteSsh.fields.target")}</FieldLabel>
        <Input
          ref={inputRef}
          data-testid="remote-ssh-target-input"
          aria-label={t("pairing.remoteSsh.fields.target")}
          defaultValue=""
          onChange={handleTargetInput}
          placeholder="user@host"
          autoCapitalize="none"
          autoCorrect="off"
          readOnly={isSaving}
          enterKeyHint="done"
          onKeyDown={handleSubmitEnter}
        />
        <FieldError data-testid="remote-ssh-target-error">{errorMessage}</FieldError>
      </Field>
      <Field data-testid="remote-ssh-password">
        <FieldLabel>{t("pairing.remoteSsh.fields.password")}</FieldLabel>
        <div className="flex flex-row items-center gap-2">
          <div className="min-w-0 flex-1">
            <Input
              data-testid="remote-ssh-password-input"
              aria-label={t("pairing.remoteSsh.fields.password")}
              defaultValue=""
              onChange={handlePasswordInput}
              placeholder={t("pairing.remoteSsh.fields.passwordOptional")}
              autoCapitalize="none"
              autoCorrect="off"
              type={isPasswordVisible ? "text" : "password"}
              readOnly={isSaving}
              enterKeyHint="done"
              onKeyDown={handleSubmitEnter}
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
        <Button className="flex-1" variant="secondary" onClick={handleCancel} disabled={isSaving}>
          {t("pairing.remoteSsh.actions.cancel")}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={handleSubmit}
          data-testid="remote-ssh-submit"
          disabled={isSaving}
        >
          <Terminal data-icon="inline-start" />
          {isSaving
            ? t("pairing.remoteSsh.actions.connecting")
            : t("pairing.remoteSsh.actions.connect")}
        </Button>
      </div>
    </AdaptiveModalSheet>
  );
}

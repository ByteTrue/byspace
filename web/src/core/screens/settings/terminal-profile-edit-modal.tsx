// Port of archive/expo-app:packages/app/src/screens/settings/terminal-profile-edit-modal.tsx: the add/edit terminal profile sheet; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/agents-page-sections.py; edit it directly.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";

export interface ProfileDraft {
  name: string;
  command: string;
  args: string;
}

interface FieldErrors {
  name?: string;
  command?: string;
}

interface TerminalProfileEditModalProps {
  visible: boolean;
  title: string;
  initialDraft: ProfileDraft;
  onClose: () => void;
  onSave: (draft: ProfileDraft) => Promise<void>;
  testID?: string;
}

export function TerminalProfileEditModal({
  visible,
  title,
  initialDraft,
  onClose,
  onSave,
  testID,
}: TerminalProfileEditModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialDraft.name);
  const [command, setCommand] = useState(initialDraft.command);
  const [args, setArgs] = useState(initialDraft.args);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const argsInputRef = useRef<HTMLInputElement>(null);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setFieldErrors((current) => ({ ...current, name: undefined }));
  }, []);
  const handleNameInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => handleNameChange(event.target.value),
    [handleNameChange],
  );

  const handleCommandChange = useCallback((value: string) => {
    setCommand(value);
    setFieldErrors((current) => ({ ...current, command: undefined }));
  }, []);
  const handleCommandInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => handleCommandChange(event.target.value),
    [handleCommandChange],
  );

  const handleArgsChange = useCallback((value: string) => {
    setArgs(value);
  }, []);
  const handleArgsInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => handleArgsChange(event.target.value),
    [handleArgsChange],
  );

  const sheetHeader = useMemo<SheetHeader>(() => ({ title }), [title]);

  useEffect(() => {
    if (!visible) {
      setIsPending(false);
      return;
    }
    setName(initialDraft.name);
    setCommand(initialDraft.command);
    setArgs(initialDraft.args);
    setFieldErrors({});
    setSubmitError(null);
    setIsPending(false);

    const timeout = setTimeout(() => {
      nameInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timeout);
  }, [visible, initialDraft.name, initialDraft.command, initialDraft.args]);

  const validate = useCallback((): boolean => {
    const errors: FieldErrors = {};
    if (name.trim().length === 0) {
      errors.name = t("settings.host.terminalProfiles.nameRequired");
    }
    if (command.trim().length === 0) {
      errors.command = t("settings.host.terminalProfiles.commandRequired");
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [command, name, t]);

  const handleSave = useCallback(async () => {
    if (isPending) return;
    setSubmitError(null);

    if (!validate()) {
      return;
    }

    setIsPending(true);
    try {
      await onSave({ name: name.trim(), command: command.trim(), args });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("common.errors.unableToSave"));
    } finally {
      setIsPending(false);
    }
  }, [args, command, isPending, name, onClose, onSave, t, validate]);

  const handleCancel = useCallback(() => {
    if (isPending) return;
    onClose();
  }, [isPending, onClose]);

  const handleNameSubmit = useCallback(() => {
    commandInputRef.current?.focus();
  }, []);
  const handleNameSubmitEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) handleNameSubmit();
    },
    [handleNameSubmit],
  );

  const handleCommandSubmit = useCallback(() => {
    argsInputRef.current?.focus();
  }, []);
  const handleCommandSubmitEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) handleCommandSubmit();
    },
    [handleCommandSubmit],
  );

  const handleArgsSubmit = useCallback(() => {
    void handleSave();
  }, [handleSave]);
  const handleArgsSubmitEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) handleArgsSubmit();
    },
    [handleArgsSubmit],
  );

  const nameError = fieldErrors.name;
  const commandError = fieldErrors.command;

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={sheetHeader}
      onClose={handleCancel}
      testID={testID}
      desktopMaxWidth={480}
    >
      <div className="flex flex-col gap-4 pb-2">
        <Field data-testid="terminal-profile-name-field" data-invalid={Boolean(nameError)}>
          <FieldLabel>{t("settings.host.terminalProfiles.nameLabel")}</FieldLabel>
          <Input
            ref={nameInputRef}
            defaultValue={initialDraft.name}
            key={visible ? "open" : "closed"}
            onChange={handleNameInput}
            placeholder={t("settings.host.terminalProfiles.namePlaceholder")}
            autoCapitalize="none"
            autoCorrect="off"
            readOnly={isPending}
            enterKeyHint="next"
            onKeyDown={handleNameSubmitEnter}
            aria-label={t("settings.host.terminalProfiles.nameLabel")}
            data-testid="terminal-profile-name-input"
          />
          <FieldError data-testid="terminal-profile-name-field-error">{nameError}</FieldError>
        </Field>

        <Field data-testid="terminal-profile-command-field" data-invalid={Boolean(commandError)}>
          <FieldLabel>{t("settings.host.terminalProfiles.commandLabel")}</FieldLabel>
          <Input
            ref={commandInputRef}
            defaultValue={initialDraft.command}
            key={visible ? "open" : "closed"}
            onChange={handleCommandInput}
            placeholder={t("settings.host.terminalProfiles.commandPlaceholder")}
            autoCapitalize="none"
            autoCorrect="off"
            readOnly={isPending}
            enterKeyHint="next"
            onKeyDown={handleCommandSubmitEnter}
            aria-label={t("settings.host.terminalProfiles.commandLabel")}
            data-testid="terminal-profile-command-input"
          />
          <FieldError data-testid="terminal-profile-command-field-error">{commandError}</FieldError>
        </Field>

        <Field data-testid="terminal-profile-args-field">
          <FieldLabel>{t("settings.host.terminalProfiles.argsLabel")}</FieldLabel>
          <Input
            ref={argsInputRef}
            defaultValue={initialDraft.args}
            key={visible ? "open" : "closed"}
            onChange={handleArgsInput}
            placeholder={t("settings.host.terminalProfiles.argsPlaceholder")}
            autoCapitalize="none"
            autoCorrect="off"
            readOnly={isPending}
            enterKeyHint="done"
            onKeyDown={handleArgsSubmitEnter}
            aria-label={t("settings.host.terminalProfiles.argsLabel")}
            data-testid="terminal-profile-args-input"
          />
          <FieldDescription data-testid="terminal-profile-args-field-hint">
            {t("settings.host.terminalProfiles.argsHint")}
          </FieldDescription>
        </Field>

        {submitError ? (
          <span
            className="text-sm leading-[normal] text-red-300"
            data-testid="terminal-profile-submit-error"
          >
            {submitError}
          </span>
        ) : null}

        <div className="mt-2 flex flex-row items-center gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onPress={handleCancel}
            disabled={isPending}
            testID="terminal-profile-cancel-button"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            className="flex-1"
            onPress={handleSave}
            disabled={isPending}
            testID="terminal-profile-save-button"
          >
            {isPending
              ? t("settings.host.terminalProfiles.saving")
              : t("settings.host.terminalProfiles.save")}
          </Button>
        </div>
      </div>
    </AdaptiveModalSheet>
  );
}

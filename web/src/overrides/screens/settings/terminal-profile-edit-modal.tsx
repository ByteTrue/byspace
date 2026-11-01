// Override of packages/app/src/screens/settings/terminal-profile-edit-modal.tsx: the add/edit terminal profile sheet; DOM view.
// Generated from the Expo file by web/scripts/port/agents-page-sections.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";

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
  const nameInputRef = useRef<EditingTextInputHandle>(null);
  const commandInputRef = useRef<EditingTextInputHandle>(null);
  const argsInputRef = useRef<EditingTextInputHandle>(null);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setFieldErrors((current) => ({ ...current, name: undefined }));
  }, []);

  const handleCommandChange = useCallback((value: string) => {
    setCommand(value);
    setFieldErrors((current) => ({ ...current, command: undefined }));
  }, []);

  const handleArgsChange = useCallback((value: string) => {
    setArgs(value);
  }, []);

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

  const handleCommandSubmit = useCallback(() => {
    argsInputRef.current?.focus();
  }, []);

  const handleArgsSubmit = useCallback(() => {
    void handleSave();
  }, [handleSave]);

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
        <Field
          label={t("settings.host.terminalProfiles.nameLabel")}
          error={nameError}
          testID="terminal-profile-name-field"
        >
          <FormTextInput
            ref={nameInputRef}
            initialValue={initialDraft.name}
            resetKey={visible ? "open" : "closed"}
            onChangeText={handleNameChange}
            placeholder={t("settings.host.terminalProfiles.namePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isPending}
            enterKeyHint="next"
            onSubmitEditing={handleNameSubmit}
            accessibilityLabel={t("settings.host.terminalProfiles.nameLabel")}
            testID="terminal-profile-name-input"
          />
        </Field>

        <Field
          label={t("settings.host.terminalProfiles.commandLabel")}
          error={commandError}
          testID="terminal-profile-command-field"
        >
          <FormTextInput
            ref={commandInputRef}
            initialValue={initialDraft.command}
            resetKey={visible ? "open" : "closed"}
            onChangeText={handleCommandChange}
            placeholder={t("settings.host.terminalProfiles.commandPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isPending}
            enterKeyHint="next"
            onSubmitEditing={handleCommandSubmit}
            accessibilityLabel={t("settings.host.terminalProfiles.commandLabel")}
            testID="terminal-profile-command-input"
          />
        </Field>

        <Field
          label={t("settings.host.terminalProfiles.argsLabel")}
          hint={t("settings.host.terminalProfiles.argsHint")}
          testID="terminal-profile-args-field"
        >
          <FormTextInput
            ref={argsInputRef}
            initialValue={initialDraft.args}
            resetKey={visible ? "open" : "closed"}
            onChangeText={handleArgsChange}
            placeholder={t("settings.host.terminalProfiles.argsPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isPending}
            enterKeyHint="done"
            onSubmitEditing={handleArgsSubmit}
            accessibilityLabel={t("settings.host.terminalProfiles.argsLabel")}
            testID="terminal-profile-args-input"
          />
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

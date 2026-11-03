// Port of archive/expo-app:packages/app/src/components/rename-modal.tsx: the rename dialog (hosts, workspaces, tabs); DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/rename-modal.py; edit it directly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { EditingTextInputHandle } from "@/components/ui/text-input";

export interface AdaptiveRenameModalProps {
  visible: boolean;
  title: string;
  initialValue: string;
  placeholder?: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void> | void;
  validate?: (value: string) => string | null;
  maxLength?: number;
  testID?: string;
}

export function AdaptiveRenameModal({
  visible,
  title,
  initialValue,
  placeholder,
  submitLabel,
  onClose,
  onSubmit,
  validate,
  maxLength,
  testID,
}: AdaptiveRenameModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<EditingTextInputHandle>(null);

  useEffect(() => {
    if (!visible) return;
    setDraft(initialValue);
    setError(null);
    setIsPending(false);
  }, [visible, initialValue]);

  useEffect(() => {
    if (!visible) return;
    const length = initialValue.length;
    const timeout = setTimeout(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      // The whole name selected, so typing replaces it.
      node.getNativeRef()?.setSelectionRange(0, length);
    }, 50);
    return () => clearTimeout(timeout);
  }, [visible, initialValue]);

  const computeError = useCallback(
    (value: string): string | null => {
      if (!value.trim()) return t("common.errors.nameRequired");
      return validate ? validate(value) : null;
    },
    [validate, t],
  );

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isPending) return;
    const value = draft;
    if (value === initialValue) return;
    const validationError = computeError(value);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      setIsPending(true);
      await onSubmit(value);
      setIsPending(false);
      onClose();
    } catch (err) {
      setIsPending(false);
      const message =
        err instanceof Error && err.message ? err.message : t("common.errors.unableToSave");
      setError(message);
    }
  }, [isPending, draft, initialValue, computeError, onSubmit, onClose, t]);

  const handleCancel = useCallback(() => {
    if (isPending) return;
    onClose();
  }, [isPending, onClose]);

  const handleSubmitVoid = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const submitDisabled = isPending || draft === initialValue || computeError(draft) !== null;
  const inputTestID = testID ? `${testID}-input` : undefined;
  const errorTestID = testID ? `${testID}-error` : undefined;
  const submitTestID = testID ? `${testID}-submit` : undefined;
  const cancelTestID = testID ? `${testID}-cancel` : undefined;
  const sheetHeader = useMemo<SheetHeader>(() => ({ title }), [title]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={handleCancel}
      header={sheetHeader}
      testID={testID}
    >
      <div className="flex flex-col gap-3 pb-2">
        <AdaptiveTextInput
          ref={inputRef}
          initialValue={initialValue}
          onChangeText={handleChange}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isPending}
          maxLength={maxLength}
          onSubmitEditing={handleSubmitVoid}
          className="rounded-md border bg-background p-3 text-sm leading-[normal]"
          testID={inputTestID}
        />
        {error ? (
          <span className="text-sm leading-[normal] text-red-300" data-testid={errorTestID}>
            {error}
          </span>
        ) : null}
        <div className="flex flex-row items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onPress={handleCancel}
            disabled={isPending}
            testID={cancelTestID}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onPress={handleSubmitVoid}
            disabled={submitDisabled}
            testID={submitTestID}
          >
            {isPending ? t("renameModal.saving") : (submitLabel ?? t("renameModal.rename"))}
          </Button>
        </div>
      </div>
    </AdaptiveModalSheet>
  );
}

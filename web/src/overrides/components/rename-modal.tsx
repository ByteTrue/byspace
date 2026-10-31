// Override of packages/app/src/components/rename-modal.tsx: the same rename dialog contract
// (validation, inline errors, stays open on failure, testIDs) on shadcn's Dialog.
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!visible) return;
    setDraft(initialValue);
    setError(null);
    setIsPending(false);
  }, [visible, initialValue]);

  const computeError = useCallback(
    (value: string): string | null => {
      if (!value.trim()) return t("common.errors.nameRequired");
      return validate ? validate(value) : null;
    },
    [validate, t],
  );

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
    setError(null);
  }, []);

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (isPending || draft === initialValue) return;
      const validationError = computeError(draft);
      if (validationError) {
        setError(validationError);
        return;
      }
      try {
        setIsPending(true);
        await onSubmit(draft);
        setIsPending(false);
        onClose();
      } catch (err) {
        setIsPending(false);
        setError(
          err instanceof Error && err.message ? err.message : t("common.errors.unableToSave"),
        );
      }
    },
    [isPending, draft, initialValue, computeError, onSubmit, onClose, t],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isPending) onClose();
    },
    [isPending, onClose],
  );

  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(0, initialValue.length);
    },
    [initialValue.length],
  );

  const submitDisabled = isPending || draft === initialValue || computeError(draft) !== null;

  return (
    <Dialog open={visible} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid={testID}
        className="sm:max-w-sm"
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Input
              ref={inputRef}
              value={draft}
              onChange={handleChange}
              placeholder={placeholder}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={isPending}
              maxLength={maxLength}
              aria-invalid={error ? true : undefined}
              data-testid={testID ? `${testID}-input` : undefined}
            />
            {error ? (
              <p
                className="text-sm text-destructive-text"
                data-testid={testID ? `${testID}-error` : undefined}
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              data-testid={testID ? `${testID}-cancel` : undefined}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={submitDisabled}
              data-testid={testID ? `${testID}-submit` : undefined}
            >
              {isPending ? t("renameModal.saving") : (submitLabel ?? t("renameModal.rename"))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

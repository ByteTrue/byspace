import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getPendingConfirmDialog, subscribeConfirmDialog } from "@/utils/confirm-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";

/** Renders the dialog behind confirmDialog() (core/utils/confirm-dialog.ts). */
export function ConfirmDialogHost() {
  const { t } = useTranslation();
  const pending = useSyncExternalStore(
    subscribeConfirmDialog,
    getPendingConfirmDialog,
    getPendingConfirmDialog,
  );
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) pending?.settle(false);
    },
    [pending],
  );
  const confirm = useCallback(() => pending?.settle(true), [pending]);
  if (!pending) return null;
  const { input } = pending;
  return (
    <AlertDialog open onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{input.title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">
            {input.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-dialog-cancel">
            {input.cancelLabel ?? t("common.actions.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-dialog-confirm"
            variant={input.destructive ? "destructive" : "default"}
            onClick={confirm}
          >
            {input.confirmLabel ?? "OK"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

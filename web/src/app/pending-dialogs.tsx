import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

// shortcut: dialogs that move over in a later step of the rewrite epic open this notice instead of
// doing nothing; each use is deleted when its dialog lands.
export function PendingDialog({
  open,
  title,
  step,
  onClose,
}: {
  open: boolean;
  title: string;
  step: 3 | 4;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="pending-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            This dialog moves to the new frontend in step {step} of the rewrite.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.actions.close", { defaultValue: "Close" })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

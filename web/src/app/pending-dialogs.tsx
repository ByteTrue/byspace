import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useChangelogStore } from "@/changelog/internal/changelog-store";
import { useAppDiagnosticStore } from "@/diagnostics/store";
import { useAddProjectFlowStore } from "@/stores/add-project-flow-store";
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

/** The app-wide dialogs packages/app's root layout mounts, as notices until their step lands. */
export function PendingDialogsHost() {
  const { t } = useTranslation();
  const addProjectRequest = useAddProjectFlowStore((state) => state.request);
  const closeAddProject = useAddProjectFlowStore((state) => state.close);
  const changelogVisible = useChangelogStore((state) => state.visible);
  const closeChangelog = useChangelogStore((state) => state.close);
  const diagnosticVisible = useAppDiagnosticStore((state) => state.visible);
  const closeDiagnostic = useAppDiagnosticStore((state) => state.close);
  return (
    <>
      <PendingDialog
        open={addProjectRequest !== null}
        title={t("sidebar.actions.addProject")}
        step={4}
        onClose={closeAddProject}
      />
      <PendingDialog
        open={changelogVisible}
        title={t("sidebar.help.whatsNew")}
        step={4}
        onClose={closeChangelog}
      />
      <PendingDialog
        open={diagnosticVisible}
        title={t("sidebar.help.diagnostics")}
        step={4}
        onClose={closeDiagnostic}
      />
    </>
  );
}

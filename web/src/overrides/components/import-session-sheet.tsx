// Override of packages/app/src/components/import-session-sheet.tsx.
// shortcut: the import-session sheet moves to the new frontend in step 4 of the rewrite epic;
// until then it opens the step notice. Same props, so the shared useImportSession hook runs as is.
import { useTranslation } from "react-i18next";
import { PendingDialog } from "~/app/pending-dialogs";

interface ImportSessionSheetProps {
  visible: boolean;
  client: unknown;
  serverId: string | null;
  cwd?: string | null;
  workspaceId?: string | null;
  onClose: () => void;
  onImportedAgent?: (agentId: string) => void;
  onImported?: (agent: { id: string; cwd: string }) => void;
}

export function ImportSessionSheet({ visible, onClose }: ImportSessionSheetProps) {
  const { t } = useTranslation();
  return (
    <PendingDialog open={visible} title={t("importSession.title")} step={4} onClose={onClose} />
  );
}

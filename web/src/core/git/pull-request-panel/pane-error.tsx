// Port of packages/app/src/git/pull-request-panel/pane-error.tsx: the PR pane when its load
// failed, with a retry.
import { RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function PullRequestPaneError({
  onRetry,
  message,
}: {
  onRetry: () => void;
  message?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 bg-sidebar px-4"
      data-testid="pr-pane-error"
    >
      <p className="text-center text-xs text-muted-foreground">
        {message ?? t("workspace.git.diff.failedRefresh")}
      </p>
      <Button variant="ghost" size="xs" leftIcon={RotateCw} onPress={onRetry}>
        {t("common.actions.retry")}
      </Button>
    </div>
  );
}

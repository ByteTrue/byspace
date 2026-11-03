// Port of archive/expo-app:packages/app/src/components/archived-agent-callout.tsx: in place of the composer for
// an archived agent — "This agent is archived" and an Unarchive button.
import { Alert, AlertAction, AlertDescription } from "~/components/ui/alert";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

export function ArchivedAgentCallout({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const [unarchiveError, setUnarchiveError] = useState<string | null>(null);
  const handleUnarchive = useCallback(async () => {
    if (!client || !isConnected || isUnarchiving) return;
    setIsUnarchiving(true);
    setUnarchiveError(null);
    try {
      await client.refreshAgent(agentId);
    } catch (error) {
      setUnarchiveError(toErrorMessage(error));
      setIsUnarchiving(false);
    }
  }, [client, isConnected, isUnarchiving, agentId]);
  return (
    <div className="relative flex flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="relative mx-auto flex min-h-[75px] w-full flex-col items-center p-4">
        <div className="flex w-full max-w-[820px] flex-col gap-2">
          <Alert>
            <AlertDescription>{t("agentPanel.archived.callout")}</AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleUnarchive}
                disabled={!isConnected || isUnarchiving}
              >
                {t("agentPanel.archived.unarchive")}
              </Button>
            </AlertAction>
          </Alert>
          {unarchiveError ? (
            <span
              className="text-center text-sm text-status-danger"
              data-testid="agent-unarchive-error"
            >
              {unarchiveError}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Override of packages/app/src/components/archived-agent-callout.tsx: in place of the composer for
// an archived agent — "This agent is archived" and an Unarchive button.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-input bg-card px-4 py-3 md:px-6 md:py-4">
            <span className="text-sm text-muted-foreground">
              {t("agentPanel.archived.callout")}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onPress={handleUnarchive}
              disabled={!isConnected || isUnarchiving}
            >
              {t("agentPanel.archived.unarchive")}
            </Button>
          </div>
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

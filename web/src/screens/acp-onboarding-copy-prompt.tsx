import { useCallback, useState } from "react";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import * as Clipboard from "@/platform/clipboard";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";

export function AcpOnboardingCopyPrompt({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const [pending, setPending] = useState(false);
  const copyPrompt = useCallback(async () => {
    if (!client || pending) return;
    setPending(true);
    try {
      const result = await client.getAcpOnboardingPrompt();
      if (result.error || !result.prompt) {
        throw new Error(result.error ?? t("settings.providers.acpOnboarding.promptUnavailable"));
      }
      if (!(await Clipboard.writeText(result.prompt))) {
        throw new Error(t("settings.providers.acpOnboarding.copyFailed"));
      }
      toast.copied(t("settings.providers.acpOnboarding.copyPrompt"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }, [client, pending, t, toast]);
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        {t("settings.providers.acpOnboarding.description")}
      </p>
      <Button type="button" disabled={!client || pending} onClick={copyPrompt}>
        {pending ? <Spinner data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
        {t("settings.providers.acpOnboarding.copyPrompt")}
      </Button>
    </div>
  );
}

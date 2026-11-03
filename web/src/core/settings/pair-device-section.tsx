// Port of archive/expo-app:packages/app/src/settings/pair-device-section.tsx: the pairing offer (relay consent, QR code, link), DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/pair-device-section.py; edit it directly.
import { useCallback, useMemo, useState, type FocusEvent } from "react";
import { Alert, AlertAction, AlertDescription } from "~/components/ui/alert";
import * as Clipboard from "~/lib/clipboard";
import * as QRCode from "qrcode";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  Copy,
  Network,
  RotateCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { Spinner } from "~/components/ui/spinner";
import { useFetchQuery } from "@/data/query";
import { daemonPairingOfferQueryKey } from "@/data/daemon-pairing";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { withTheme } from "~/app/theme-object";
import { Input } from "~/components/ui/input";

function selectOnFocus(event: FocusEvent<HTMLInputElement>): void {
  event.currentTarget.select();
}

const RELAY_DOCS_URL = "https://github.com/ByteTrue/byspace/blob/main/SECURITY.md";
const ThemedShieldCheck = withTheme(ShieldCheck);
const ThemedNetwork = withTheme(Network);
const accentBrightColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

export interface PairDeviceSectionProps {
  serverId: string;
  onClose: () => void;
}

export function PairDeviceSection({ serverId, onClose }: PairDeviceSectionProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const isConnected = runtimeSnapshot?.connectionStatus === "online";
  const isDisconnected =
    runtimeSnapshot?.connectionStatus === "offline" ||
    runtimeSnapshot?.connectionStatus === "error";
  const { patchConfig } = useDaemonConfig(serverId);
  const [copied, setCopied] = useState(false);
  const serverFeatures = client?.getLastServerInfoMessage()?.features;
  const supportsPairingRpc = serverFeatures?.daemonStatusRpc === true;
  const canConfigureRelay = supportsPairingRpc && serverFeatures?.relayConfig === true;

  const pairingQuery = useFetchQuery({
    queryKey: daemonPairingOfferQueryKey(serverId),
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.getDaemonPairingOffer();
    },
    enabled: supportsPairingRpc && Boolean(client && isConnected),
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
    retry: 1,
  });

  const enableRelay = useMutation({
    mutationFn: async () => {
      if (client?.getLastServerInfoMessage()?.features?.relayConfig !== true) {
        throw new Error(t("pairing.device.updateRequired"));
      }
      const config = await patchConfig({ relay: { enabled: true } });
      if (!config) throw new Error(t("workspace.terminal.hostDisconnected"));
      return pairingQuery.refetch();
    },
  });

  const qrQuery = useFetchQuery({
    queryKey: ["daemon-pairing-offer-qr", pairingQuery.data?.url],
    queryFn: () =>
      QRCode.toString(pairingQuery.data?.url ?? "", {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 480,
      }),
    enabled: Boolean(pairingQuery.data?.url),
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
  });

  const handleCopyLink = useCallback(async () => {
    if (!pairingQuery.data?.url) return;
    await Clipboard.writeText(pairingQuery.data.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [pairingQuery.data?.url]);
  const handleCopyPress = useCallback(() => {
    void handleCopyLink();
  }, [handleCopyLink]);
  const handleRetry = useCallback(() => {
    void pairingQuery.refetch();
  }, [pairingQuery]);
  const handleEnableRelay = useCallback(() => {
    enableRelay.mutate();
  }, [enableRelay]);

  const qrSvg = useMemo(() => qrQuery.data ?? null, [qrQuery.data]);

  return (
    <div data-testid="pair-device-content">
      <PairDeviceBody
        isPending={supportsPairingRpc && pairingQuery.isPending}
        isDisconnected={isDisconnected}
        error={pairingQuery.error}
        offer={pairingQuery.data}
        canConfigureRelay={canConfigureRelay}
        enablePending={enableRelay.isPending}
        enableError={enableRelay.error}
        qrSvg={qrSvg}
        qrError={qrQuery.isError}
        copied={copied}
        onRetry={handleRetry}
        onEnableRelay={handleEnableRelay}
        onClose={onClose}
        onCopy={handleCopyPress}
      />
    </div>
  );
}

interface PairDeviceBodyProps {
  isPending: boolean;
  isDisconnected: boolean;
  error: Error | null;
  offer: { relayEnabled: boolean; url: string } | undefined;
  canConfigureRelay: boolean;
  enablePending: boolean;
  enableError: Error | null;
  qrSvg: string | null;
  qrError: boolean;
  copied: boolean;
  onRetry: () => void;
  onEnableRelay: () => void;
  onClose: () => void;
  onCopy: () => void;
}

function PairDeviceBody(props: PairDeviceBodyProps) {
  const { t } = useTranslation();
  if (props.isDisconnected) {
    return (
      <OfferLoadError message={t("workspace.terminal.hostDisconnected")} onRetry={props.onRetry} />
    );
  }
  if (props.isPending) {
    return (
      <span className="block py-6 text-center text-sm leading-[normal] text-muted-foreground">
        {t("pairing.device.loadingOffer")}
      </span>
    );
  }
  if (props.error) {
    return <OfferLoadError message={props.error.message} onRetry={props.onRetry} />;
  }
  if (!props.offer?.relayEnabled) {
    return <RelayConsent {...props} />;
  }
  if (!props.offer.url) {
    return (
      <span className="block py-6 text-center text-sm leading-[normal] text-muted-foreground">
        {t("pairing.device.unavailable")}
      </span>
    );
  }
  return <PairingOffer {...props} offer={props.offer} />;
}

function OfferLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" leftIcon={RotateCw} onPress={onRetry}>
          {t("pairing.device.retry")}
        </Button>
      </AlertAction>
    </Alert>
  );
}

function RelayConsent(props: PairDeviceBodyProps) {
  const { t } = useTranslation();
  let enableButtonLabel = t("pairing.device.enableRelay");
  if (props.enablePending) {
    enableButtonLabel = t("pairing.device.enablingRelay");
  } else if (props.enableError) {
    enableButtonLabel = t("pairing.device.retry");
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-2">
        <RelayHeroBadge />
        <span className="text-sm leading-[normal] font-medium text-foreground">
          {t("pairing.device.enableTitle")}
        </span>
        <span className="text-sm leading-[21px] text-muted-foreground">
          {t("pairing.device.enableDescription")}
        </span>
        <ExternalLink
          href={RELAY_DOCS_URL}
          label={t("pairing.device.relayDocs")}
          accessibilityLabel={t("pairing.device.relayDocsAccessibility")}
        />
      </div>
      {props.enableError ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{props.enableError.message}</AlertDescription>
        </Alert>
      ) : null}
      {!props.canConfigureRelay ? (
        <Alert>
          <TriangleAlert />
          <AlertDescription>{t("pairing.device.updateRequired")}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-row gap-3">
        <Button variant="secondary" className="flex-1" onPress={props.onClose}>
          {t("pairing.device.notNow")}
        </Button>
        {props.canConfigureRelay ? (
          <Button
            variant="default"
            className="flex-1"
            loading={props.enablePending}
            onPress={props.onEnableRelay}
          >
            {enableButtonLabel}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-row items-start gap-2 border-t pt-4">
        {/* mt-px: seats the glyph on the hint's first text line */}
        <ThemedNetwork size={14} className="mt-px shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-xs leading-[18px] text-muted-foreground">
          {t("pairing.device.directConnectionHint")}
        </span>
      </div>
    </div>
  );
}

function RelayHeroBadge() {
  return (
    <div className="mb-1 flex size-12 items-center justify-center rounded-full border bg-muted">
      <ThemedShieldCheck size={20} themeProps={accentBrightColorMapping} />
    </div>
  );
}

function PairingOffer(props: PairDeviceBodyProps & { offer: { url: string } }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <span className="text-center text-sm leading-[normal] text-muted-foreground">
        {t("pairing.device.hint")}
      </span>
      <div className="flex aspect-square w-[304px] max-w-full items-center justify-center self-center rounded-xl border bg-white p-3">
        <PairingQr svg={props.qrSvg} isError={props.qrError} />
      </div>
      <div className="flex flex-row items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            value={props.offer.url}
            readOnly
            onFocus={selectOnFocus}
            aria-label={t("pairing.link.label")}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          leftIcon={props.copied ? Check : Copy}
          onPress={props.onCopy}
        >
          {props.copied ? t("pairing.device.copied") : t("pairing.device.copy")}
        </Button>
      </div>
      <Alert>
        <TriangleAlert />
        <AlertDescription>{t("pairing.device.securityWarning")}</AlertDescription>
      </Alert>
    </div>
  );
}

function PairingQr({ svg, isError }: { svg: string | null; isError: boolean }) {
  const { t } = useTranslation();
  const markup = useMemo(() => (svg ? { __html: svg } : null), [svg]);
  if (markup) {
    return (
      // The qrcode package's own SVG markup, scaled to the tile.
      <div
        role="img"
        aria-label={t("pairing.device.qrAccessibility")}
        className="size-full [&>svg]:size-full"
        dangerouslySetInnerHTML={markup}
      />
    );
  }
  if (isError) {
    return (
      <span className="text-xs leading-[normal] text-muted-foreground">
        {t("pairing.device.qrUnavailable")}
      </span>
    );
  }
  return <Spinner className="text-muted-foreground" />;
}

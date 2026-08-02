import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as QRCode from "qrcode";
import { StyleSheet } from "react-native-unistyles";
import { RotateCw, Copy, Check } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";

type PairingViewState =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "unavailable"; message: string }
  | { tag: "ready"; url: string };

function resolvePairingViewState(args: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: { url?: string | null; relayEnabled?: boolean } | undefined;
  labels: {
    failedToLoadOffer: string;
    relayDisabled: string;
    unavailable: string;
  };
}): PairingViewState {
  if (args.isPending) return { tag: "loading" };
  if (args.isError) {
    const message =
      args.error instanceof Error ? args.error.message : args.labels.failedToLoadOffer;
    return { tag: "error", message };
  }
  if (!args.data?.url) {
    const message =
      args.data?.relayEnabled === false ? args.labels.relayDisabled : args.labels.unavailable;
    return { tag: "unavailable", message };
  }
  return { tag: "ready", url: args.data.url };
}

export function PairDeviceSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const daemonClient = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const pairingQuery = useFetchQuery({
    queryKey: ["daemon-pairing", serverId],
    queryFn: () => daemonClient!.getDaemonPairingOffer(),
    enabled: !!daemonClient && isConnected,
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
    retry: 1,
  });

  const qrQuery = useFetchQuery({
    queryKey: ["daemon-pairing-qr", serverId, pairingQuery.data?.url],
    queryFn: () =>
      QRCode.toDataURL(pairingQuery.data!.url!, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 480,
      }),
    enabled: !!pairingQuery.data?.url,
    dataShape: "value",
    staleTimeMs: 24 * 60 * 60 * 1000,
  });

  const handleCopyLink = useCallback(async () => {
    if (!pairingQuery.data?.url) return;
    await Clipboard.setStringAsync(pairingQuery.data.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [pairingQuery.data?.url]);

  const handleRefetch = useCallback(() => {
    void pairingQuery.refetch();
  }, [pairingQuery]);

  const handleCopyPress = useCallback(() => {
    void handleCopyLink();
  }, [handleCopyLink]);

  const qrImageSource = useMemo(
    () => (qrQuery.data ? { uri: qrQuery.data } : null),
    [qrQuery.data],
  );

  const bodyLabels = useMemo(
    () => ({
      loadingOffer: t("pairing.device.loadingOffer"),
      hint: t("pairing.device.hint"),
      qrUnavailable: t("pairing.device.qrUnavailable"),
      retry: t("pairing.device.retry"),
      copy: t("pairing.device.copy"),
      copied: t("pairing.device.copied"),
    }),
    [t],
  );

  const viewState = resolvePairingViewState({
    isPending: pairingQuery.isPending,
    isError: pairingQuery.isError,
    error: pairingQuery.error,
    data: pairingQuery.data,
    labels: {
      failedToLoadOffer: t("pairing.device.failedToLoadOffer"),
      relayDisabled: t("pairing.device.relayDisabled"),
      unavailable: t("pairing.device.unavailable"),
    },
  });

  return (
    <View style={settingsStyles.section} testID="host-page-pair-device-card">
      <View style={settingsStyles.card}>
        <PairDeviceBody
          viewState={viewState}
          qrImageSource={qrImageSource}
          qrQuery={qrQuery}
          copied={copied}
          handleRefetch={handleRefetch}
          handleCopyPress={handleCopyPress}
          labels={bodyLabels}
        />
      </View>
    </View>
  );
}

interface PairDeviceBodyProps {
  viewState: PairingViewState;
  qrImageSource: { uri: string } | null;
  qrQuery: { isError: boolean };
  copied: boolean;
  handleRefetch: () => void;
  handleCopyPress: () => void;
  labels: {
    loadingOffer: string;
    hint: string;
    qrUnavailable: string;
    retry: string;
    copy: string;
    copied: string;
  };
}

function PairDeviceBody(props: PairDeviceBodyProps) {
  const { viewState, qrImageSource, qrQuery, copied, handleRefetch, handleCopyPress, labels } =
    props;

  const retryIcon = useMemo(() => <RotateCw size={14} />, []);
  const copyIcon = useMemo(() => (copied ? <Check size={14} /> : <Copy size={14} />), [copied]);

  if (viewState.tag === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" />
        <Text style={styles.hint}>{labels.loadingOffer}</Text>
      </View>
    );
  }

  if (viewState.tag === "error" || viewState.tag === "unavailable") {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>{viewState.message}</Text>
        <Button variant="outline" size="sm" leftIcon={retryIcon} onPress={handleRefetch}>
          {labels.retry}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.content}>
      <Text style={styles.hint}>{labels.hint}</Text>
      <View style={styles.qrContainer}>
        <PairDeviceQrContent
          qrImageSource={qrImageSource}
          qrQuery={qrQuery}
          unavailableLabel={labels.qrUnavailable}
        />
      </View>
      <View style={styles.linkRow}>
        <View style={styles.inputWrapper}>
          <TextInput style={styles.linkInput} value={viewState.url} readOnly selectTextOnFocus />
        </View>
        <Button variant="outline" size="sm" leftIcon={copyIcon} onPress={handleCopyPress}>
          {copied ? labels.copied : labels.copy}
        </Button>
      </View>
    </View>
  );
}

function PairDeviceQrContent(props: {
  qrImageSource: { uri: string } | null;
  qrQuery: { isError: boolean };
  unavailableLabel: string;
}) {
  if (props.qrImageSource) {
    return <Image source={props.qrImageSource} style={styles.qrImage} resizeMode="contain" />;
  }
  if (props.qrQuery.isError) {
    return <Text style={styles.hint}>{props.unavailableLabel}</Text>;
  }
  return <ActivityIndicator size="small" />;
}

const styles = StyleSheet.create((theme) => ({
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
  },
  content: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
  },
  qrContainer: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    width: 320,
    height: 320,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[2],
  },
  qrImage: {
    width: "100%",
    height: "100%",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inputWrapper: {
    flex: 1,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  linkInput: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    outlineStyle: "none",
  } as object,
}));

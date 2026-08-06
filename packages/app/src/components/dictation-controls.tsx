import { Button } from "@/components/ui/button";
import type { DictationStatus } from "@/hooks/use-dictation";
import { RefreshCcw, Square, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { VolumeMeter } from "./volume-meter";

interface DictationToolbarProps {
  volume: number;
  duration: number;
  isRecording: boolean;
  isProcessing: boolean;
  status: DictationStatus;
  errorText?: string;
  onCancel: () => void;
  onStop: () => void;
  onRetry?: () => void;
  onDiscard?: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function DictationToolbar({
  volume,
  duration,
  isRecording,
  isProcessing,
  status,
  errorText,
  onCancel,
  onStop,
  onRetry,
  onDiscard,
}: DictationToolbarProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isFailed = status === "failed";
  const handleCancel = isFailed && onDiscard ? onDiscard : onCancel;

  let actions = (
    <Button
      variant="ghost"
      size="xs"
      loading
      disabled
      style={styles.iconButton}
      accessibilityLabel={t("message.dictation.stop")}
    />
  );
  if (isFailed) {
    actions = (
      <Button
        variant="default"
        size="xs"
        leftIcon={RefreshCcw}
        onPress={onRetry}
        accessibilityLabel={t("message.dictation.retry")}
        style={styles.iconButton}
      />
    );
  } else if (isRecording && !isProcessing) {
    actions = (
      <Button
        variant="default"
        size="xs"
        leftIcon={Square}
        onPress={onStop}
        accessibilityLabel={t("message.dictation.stop")}
        style={styles.iconButton}
        testID="dictation-stop"
      />
    );
  }

  return (
    <View style={styles.container} testID="dictation-toolbar">
      <Button
        variant="ghost"
        size="xs"
        leftIcon={X}
        onPress={handleCancel}
        accessibilityLabel={t("message.dictation.cancel")}
        style={styles.iconButton}
        testID="dictation-cancel"
      />

      <View style={styles.status}>
        {isFailed ? (
          <Text numberOfLines={1} style={styles.errorText}>
            {errorText
              ? t("message.dictation.failed", { error: errorText })
              : t("message.dictation.failedRetry")}
          </Text>
        ) : (
          <>
            <VolumeMeter
              volume={volume}
              isSpeaking={isRecording}
              orientation="horizontal"
              variant="compact"
              color={theme.colors.foregroundMuted}
            />
            <Text style={styles.timerText}>{formatDuration(duration)}</Text>
          </>
        )}
      </View>

      <View style={styles.actions}>{actions}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    minHeight: 40,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  status: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  timerText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  errorText: {
    flexShrink: 1,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  iconButton: {
    width: 32,
    minHeight: 32,
    paddingHorizontal: 0,
  },
}));

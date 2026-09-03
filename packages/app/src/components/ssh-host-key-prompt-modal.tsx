import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ShieldAlert, ShieldQuestion } from "lucide-react-native";
import {
  listenToSshHostKeyPrompts,
  respondSshHostKeyPrompt,
  type SshHostKeyPromptPayload,
} from "@/desktop/daemon/desktop-daemon";
import { Button } from "@/components/ui/button";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";

const FLEX_ONE_STYLE = { flex: 1 } as const;
const ThemedShieldQuestion = withUnistyles(ShieldQuestion);
const ThemedShieldAlert = withUnistyles(ShieldAlert);

const styles = StyleSheet.create((theme) => ({
  promptRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
    alignItems: "flex-start",
  },
  promptText: {
    flex: 1,
    gap: theme.spacing[2],
  },
  fingerprint: {
    fontFamily: "monospace",
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  warning: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

/** Renders the pending host-key fingerprint prompt sent by the main process. */
export function SshHostKeyPromptModal() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<SshHostKeyPromptPayload | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToSshHostKeyPrompts((incoming) => {
      if (disposed) {
        return;
      }
      // The main process re-emits the same prompt while the handshake is
      // suspended; one dialog per promptId is enough.
      setPrompt((current) => (current?.promptId === incoming.promptId ? current : incoming));
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return undefined;
        }
        unlisten = cleanup;
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const respond = useCallback(
    (decision: "trust" | "cancel") => {
      if (!prompt) {
        return;
      }
      void respondSshHostKeyPrompt({ promptId: prompt.promptId, decision }).catch(() => undefined);
      setPrompt(null);
    },
    [prompt],
  );

  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.remoteSsh.hostKey.title") }), [t]);
  const isChanged = prompt?.kind === "changed";
  const ThemedIcon = isChanged ? ThemedShieldAlert : ThemedShieldQuestion;
  const handleReject = useCallback(() => respond("cancel"), [respond]);
  const handleTrust = useCallback(() => respond("trust"), [respond]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={prompt !== null}
      onClose={handleReject}
      testID="ssh-host-key-prompt-modal"
    >
      {prompt ? (
        <View style={styles.promptRow}>
          <ThemedIcon size={22} />
          <View style={styles.promptText}>
            <Text style={styles.detail}>
              {isChanged
                ? t("pairing.remoteSsh.hostKey.changedWarning", { target: prompt.target })
                : t("pairing.remoteSsh.hostKey.firstUseMessage", { target: prompt.target })}
            </Text>
            <Text style={styles.fingerprint}>{prompt.fingerprint}</Text>
            {isChanged && prompt.pinnedFingerprint ? (
              <Text style={styles.warning}>
                {t("pairing.remoteSsh.hostKey.pinnedFingerprint", {
                  fingerprint: prompt.pinnedFingerprint,
                })}
              </Text>
            ) : null}
            <Text style={styles.detail}>{t("pairing.remoteSsh.hostKey.help")}</Text>
          </View>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant={isChanged ? "ghost" : "secondary"}
          onPress={handleReject}
          testID="ssh-host-key-reject"
        >
          {t("pairing.remoteSsh.hostKey.reject")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant={isChanged ? "destructive" : "default"}
          onPress={handleTrust}
          testID="ssh-host-key-trust"
        >
          {t("pairing.remoteSsh.hostKey.trust")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

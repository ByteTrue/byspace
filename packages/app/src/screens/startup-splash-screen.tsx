import { ActivityIndicator, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BySpaceLogo } from "@/components/icons/byspace-logo";
import { Button } from "@/components/ui/button";

interface StartupSplashScreenProps {
  bootstrapState?: {
    splashError: string | null;
    retry: () => void;
  };
}

export function StartupSplashScreen({ bootstrapState }: StartupSplashScreenProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  if (bootstrapState?.splashError) {
    return (
      <View style={styles.container}>
        <BySpaceLogo size={64} />
        <Text style={styles.message}>{bootstrapState.splashError}</Text>
        <Button size="sm" onPress={bootstrapState.retry}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <BySpaceLogo size={64} />
      <ActivityIndicator color={theme.colors.foregroundMuted} />
      <Text style={styles.message}>{t("startup.connecting")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

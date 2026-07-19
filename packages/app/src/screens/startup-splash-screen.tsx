import { ActivityIndicator, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { PaseoLogo } from "@/components/icons/paseo-logo";

export function StartupSplashScreen() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  return (
    <View style={styles.container}>
      <PaseoLogo size={64} />
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

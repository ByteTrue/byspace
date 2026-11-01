"""Port packages/app's components/welcome-screen.tsx and setup-guide-modal.tsx to web/src/overrides:
the first-run screen (connect a host: setup guide, direct connection, pairing link, settings) and
the setup guide sheet. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

# ---- welcome-screen.tsx
p = Port("components/welcome-screen.tsx")
p.rep('''import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { QrCode, Link2, ClipboardPaste, Settings, Terminal } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
''', '''import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { QrCode, Link2, ClipboardPaste, Settings, Terminal } from "lucide-react";
import { cn } from "cn";
''')
p.rep('''import { AddHostModal } from "./add-host-modal";
import { AddRemoteSshHostModal } from "./add-remote-ssh-host-modal";
import { PairLinkModal } from "./pair-link-modal";
import { SetupGuideModal } from "./setup-guide-modal";
''', '''import { AddHostModal } from "@/components/add-host-modal";
import { AddRemoteSshHostModal } from "@/components/add-remote-ssh-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";
import { SetupGuideModal } from "@/components/setup-guide-modal";
''')
p.between("const styles = StyleSheet.create((theme) => ({", "function useAnyHostOnline(", "")
p.rep('''export function WelcomeScreen({ onHostAdded }: WelcomeScreenProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();''', '''export function WelcomeScreen({ onHostAdded }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();''')
p.rep('''  const scrollContentContainerStyle = useMemo(
    () => [styles.container, { paddingBottom: theme.spacing[6] + insets.bottom }],
    [theme.spacing, insets.bottom],
  );

''', "")
p.rep('''    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={scrollContentContainerStyle}
        showsVerticalScrollIndicator={false}
        testID="welcome-screen"
      >
        <View style={styles.content}>
          <BySpaceLogo size={96} />
          <View style={styles.copyBlock}>
            <Text style={styles.title}>{t("onboarding.title")}</Text>
            <Text style={styles.subtitle}>{t("onboarding.subtitle")}</Text>
          </View>

          <View style={styles.actions}>
            {actions.map((action) => (
              <WelcomeActionButton key={action.key} action={action} />
            ))}
          </View>
''', '''    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none]"
        data-testid="welcome-screen"
      >
        <div className="flex grow flex-col items-center p-6 pb-[calc(24px+env(safe-area-inset-bottom))]">
        <div className="flex w-full grow flex-col items-center justify-center">
          <BySpaceLogo size={96} />
          <div className="mb-12 flex flex-col items-center gap-2">
            <span className="text-center text-sm leading-[normal] font-medium text-foreground">
              {t("onboarding.title")}
            </span>
            <span className="text-center text-sm leading-[normal] text-muted-foreground">
              {t("onboarding.subtitle")}
            </span>
          </div>

          <div className="flex w-full max-w-[420px] flex-col gap-3">
            {actions.map((action) => (
              <WelcomeActionButton key={action.key} action={action} />
            ))}
          </div>
''')
p.rep('''            onPress={handleOpenSettings}
            style={styles.settingsButton}
            testID="welcome-open-settings"
          >
            {t("onboarding.actions.settings")}
          </Button>
        </View>
        <Text style={styles.versionLabel}>{appVersionText}</Text>
''', '''            onPress={handleOpenSettings}
            className="mt-6 self-center"
            testID="welcome-open-settings"
          >
            {t("onboarding.actions.settings")}
          </Button>
        </div>
        <span className="mt-6 text-center text-xs leading-[normal] text-muted-foreground">
          {appVersionText}
        </span>
''')
p.rep('''          onSaved={handleHostSaved}
        />
      </ScrollView>
    </View>
  );
}''', '''          onSaved={handleHostSaved}
        />
        </div>
      </div>
    </div>
  );
}''')
p.rep('''function WelcomeActionButton({ action }: WelcomeActionButtonProps) {
  const { theme } = useUnistyles();
  const Icon = action.icon;
  const buttonStyle = useMemo(
    () => [styles.actionButton, action.primary ? styles.actionButtonPrimary : null],
    [action.primary],
  );
  const textStyle = useMemo(
    () => [styles.actionText, action.primary ? styles.actionTextPrimary : null],
    [action.primary],
  );
  return (
    <Pressable style={buttonStyle} onPress={action.onPress} testID={action.testID}>
      <Icon
        size={18}
        color={action.primary ? theme.colors.accentForeground : theme.colors.foreground}
      />
      <Text style={textStyle}>{action.label}</Text>
    </Pressable>
  );
}''', '''function WelcomeActionButton({ action }: WelcomeActionButtonProps) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      onClick={action.onPress}
      data-testid={action.testID}
      className={cn(
        "flex flex-row items-center justify-center gap-3 rounded-[14px] border py-4",
        action.primary
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-muted text-foreground",
      )}
    >
      <Icon size={18} />
      <span className="text-sm leading-[normal] font-medium">{action.label}</span>
    </button>
  );
}''')
p.check()
p.write("the first-run screen; DOM view.", "welcome-screen.py")

# ---- setup-guide-modal.tsx
p = Port("components/setup-guide-modal.tsx")
p.rep('''import { Alert, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { ClipboardPaste, Copy } from "lucide-react-native";
''', '''import { Alert } from "react-native";
import { ClipboardPaste, Copy } from "lucide-react";
''')
p.rep('''import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
''', '''import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
''')
p.rep('''import { CODE_SURFACE_DATASET } from "@/styles/code-surface";

const FLEX_ONE_STYLE = { flex: 1 } as const;
''', "")
p.between("const styles = StyleSheet.create((theme) => ({", "interface CommandBlockProps {", "")
p.rep('''  const copyIcon = useMemo(
    () => <Copy size={16} color={UnistylesRuntime.getTheme().colors.foregroundMuted} />,
    [],
  );
  return (
    <View style={styles.command} testID={testID}>
      <Text selectable dataSet={CODE_SURFACE_DATASET} style={styles.commandText}>
        {command}
      </Text>
      <Button variant="ghost" size="sm" leftIcon={copyIcon} onPress={handleCopyPress}>
        {copyLabel}
      </Button>
    </View>
  );''', '''  // size-4 keeps the 16px packages/app draws; the button would size an unsized icon to its own.
  const copyIcon = useMemo(() => <Copy size={16} className="size-4 text-muted-foreground" />, []);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border bg-muted px-4 py-3" data-testid={testID}>
      <span
        data-pmono=""
        className="font-mono text-sm leading-[normal] break-words whitespace-pre-wrap text-foreground select-text"
      >
        {command}
      </span>
      <Button variant="ghost" size="sm" leftIcon={copyIcon} onPress={handleCopyPress}>
        {copyLabel}
      </Button>
    </div>
  );''')
p.rep('''  const pairIcon = useMemo(
    () => <ClipboardPaste size={16} color={UnistylesRuntime.getTheme().colors.accentForeground} />,
    [],
  );''', '''  const pairIcon = useMemo(() => <ClipboardPaste size={16} className="size-4" />, []);''')
p.rep('''<View style={styles.step}>''', '''<div className="flex flex-col gap-2">''', count=3)
p.rep('''<Text style={styles.stepTitle}>''', '''<span className={STEP_TITLE}>''', count=3)
p.rep('''<Text style={styles.stepText}>''', '''<span className={MUTED_TEXT}>''', count=2)
p.rep('''<View style={styles.field}>''', '''<div className="flex flex-col gap-2">''', count=2)
p.rep('''<Text style={styles.label}>''', '''<span className={FIELD_LABEL}>''', count=2)
p.rep('''<Text style={styles.helper}>''', '''<span className={MUTED_TEXT}>''')
p.rep('''              placeholderTextColor={UnistylesRuntime.getTheme().colors.foregroundMuted}
              style={styles.input}''', '''              className={INPUT}''')
p.rep('''            placeholderTextColor={UnistylesRuntime.getTheme().colors.foregroundMuted}
            style={styles.input}''', '''            className={INPUT}''')
p.rep('''          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}''',
      '''          {errorMessage ? (
            <span className="text-sm leading-[normal] text-destructive">{errorMessage}</span>
          ) : null}''')
p.rep('''      <View style={styles.actions}>''', '''      <div className="mt-2 flex flex-row gap-3">''')
p.rep('''          style={FLEX_ONE_STYLE}
          variant="secondary"''', '''          className="flex-1"
          variant="secondary"''')
p.rep('''          style={FLEX_ONE_STYLE}
          variant="default"''', '''          className="flex-1"
          variant="default"''')
# nativeID only gave the RN web input a DOM id nothing refers to.
p.sub(r'\n\s*nativeID="setup-guide-[a-z-]+"', "", count=2)
p.dom_tags()
p.dom_attrs()
p.s += '''
const STEP_TITLE = "text-sm leading-[normal] font-medium text-foreground";
const MUTED_TEXT = "text-sm leading-[normal] text-muted-foreground";
const FIELD_LABEL = "text-sm leading-[normal] font-medium text-muted-foreground";
const INPUT = "rounded-[10px] border bg-muted px-4 py-3 text-sm leading-[normal] text-foreground placeholder:text-muted-foreground";
'''
p.check(allow=('react-native"',))
p.write("the setup guide sheet; DOM view.", "welcome-screen.py")

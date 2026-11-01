#!/usr/bin/env python3
"""Port packages/app's What's new sheet (changelog/internal/changelog-sheet.tsx): the release notes
from CHANGELOG.md, revealed a few releases at a time, the installed one badged. Loading, retry and
reveal are the Expo file's; the view is DOM."""
from _port import Port

p = Port("changelog/internal/changelog-sheet.tsx")
p.rep('import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";\n', "")
p.rep('import { ExternalLink, Gift } from "lucide-react-native";', 'import { ExternalLink, Gift } from "lucide-react";')
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";', 'import { withUnistyles } from "react-native-unistyles";')
p.rep('''import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";''', '''import {
  iconButtonChromeClassName,
  iconButtonChromeGlyphSize,
} from "@/components/ui/icon-button-chrome";''')
p.rep('''import { useChangelog, type ChangelogState } from "./changelog-source";
import { useRevealedReleases } from "./use-revealed-releases";''', '''import { useChangelog, type ChangelogState } from "@/changelog/internal/changelog-source";
import { useRevealedReleases } from "@/changelog/internal/use-revealed-releases";''')
p.rep('''} from "./parse-changelog";''', '''} from "@/changelog/internal/parse-changelog";''')
p.rep('''const websiteButtonStyle = (state: PressableStateCallbackType & { hovered?: boolean }) =>
  iconButtonChromeStyle({ size: "large", state });
''', '''const WEBSITE_BUTTON = iconButtonChromeClassName({ size: "large" });
''')
p.rep('''        <Pressable
          onPress={handleOpenWebsite}
          hitSlop={8}
          style={websiteButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("changelog.openWebsite")}
          testID="changelog-open-website"
        >
          <ThemedExternalLink
            size={iconButtonChromeGlyphSize("large")}
            uniProps={mutedColorMapping}
          />
        </Pressable>''', '''        <button
          type="button"
          onClick={handleOpenWebsite}
          className={WEBSITE_BUTTON}
          aria-label={t("changelog.openWebsite")}
          data-testid="changelog-open-website"
        >
          <ThemedExternalLink
            size={iconButtonChromeGlyphSize("large")}
            uniProps={mutedColorMapping}
          />
        </button>''')
CENTERED = '<View className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3">'
p.rep("      <View style={styles.centered}>", f"      {CENTERED}", 2)
p.rep("    <View style={styles.releaseList}>", '    <View className="flex flex-col gap-8 pb-4">')
p.rep('''          style={styles.showMore}
''', '''          className="self-center"
''')
p.rep('''    <View style={styles.release} testID={`changelog-release-${release.version}`}>
      <View style={styles.releaseHeading}>
        <Text style={styles.version}>{release.version}</Text>
        {isCurrent ? <StatusBadge label={t("changelog.installed")} /> : null}
        <View style={styles.headingSpacer} />
        {date ? <Text style={styles.date}>{date}</Text> : null}
      </View>''', '''    <View
      className="flex flex-col gap-4"
      data-testid={`changelog-release-${release.version}`}
    >
      <View className="flex flex-row items-center gap-2 border-b pb-2">
        <Text className="text-base leading-[normal] font-medium text-foreground">
          {release.version}
        </Text>
        {isCurrent ? <StatusBadge label={t("changelog.installed")} /> : null}
        <View className="flex-1" />
        {date ? <Text className="text-xs leading-[normal] text-muted-foreground">{date}</Text> : null}
      </View>''')
p.rep('''        <View key={key} style={styles.section}>
          {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}''',
      '''        <View key={key} className="flex flex-col gap-2">
          {section.title ? (
            <Text className="text-xs leading-[normal] font-medium tracking-[0.5px] text-muted-foreground uppercase">
              {section.title}
            </Text>
          ) : null}''')
p.cut_from("const styles = StyleSheet.create((theme) => ({")
p.dom_tags()
p.check()
p.write("What's new — the release notes, revealed a few at a time. Same logic, DOM view.",
        "changelog-sheet.py")

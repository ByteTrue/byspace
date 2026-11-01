"""Port packages/app's screens/open-project-screen.tsx to web/src/overrides: the home screen shown
when no workspace is open (Add project, Import session, Set up providers, Pair device, community
links). Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("screens/open-project-screen.tsx")
p.rep('''import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { FolderOpen, Inbox, Plug, Smartphone } from "lucide-react-native";
''', '''import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { FolderOpen, Inbox, Plug, Smartphone } from "lucide-react";
import { cn } from "cn";
''')
p.rep('''import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
''', '''import { useIsCompactFormFactor } from "@/constants/layout";
''')

# Layout. The desktop offsets are packages/app's: content padding-bottom and the community row's
# bottom are the header height (36) plus 24 / 8. On a phone packages/app pinned the links 72px from
# the bottom over a page that could not scroll, so on a short screen they covered a tile and the
# last tile was cut off. Here the page scrolls and the links follow the tiles on a phone; on a tall
# phone they land where they did.
p.rep('''    <View style={styles.container}>
      <MenuHeader borderless />
      <View style={styles.content}>
        <View style={styles.logo}>
          <BySpaceLogo size={52} />
        </View>
        <View style={styles.tiles}>''', '''    <div className="relative flex min-h-0 flex-1 flex-col bg-background select-none">
      <MenuHeader borderless />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="relative flex flex-1 flex-col items-center justify-start p-6 pt-12 md:justify-center md:pt-6 md:pb-[60px]">
        <div className="mb-8">
          <BySpaceLogo size={52} />
        </div>
        <div className="mt-6 flex w-full max-w-[452px] flex-row flex-wrap justify-start gap-3 md:mt-12">''')
p.rep('''          ) : null}
        </View>
      </View>
      <View style={styles.communityRow}>
        <CommunityLinks />
      </View>''', '''          ) : null}
        </div>
      </div>
      <div className="mb-[72px] flex shrink-0 flex-row items-center justify-center md:absolute md:inset-x-0 md:bottom-11 md:mb-0">
        <CommunityLinks />
      </div>
      </div>''')
p.rep('''      {importSession.sheet}
    </View>
  );
}''', '''      {importSession.sheet}
    </div>
  );
}''')

# Tile
p.rep('''interface HomeTileProps {
  icon: ComponentType<{ size: number; color: string }>;''', '''interface HomeTileProps {
  icon: ComponentType<{ size: number; className?: string }>;''')
p.rep('''function HomeTile({ icon: Icon, title, description, onPress, testID, accent }: HomeTileProps) {
  // useUnistyles is acceptable here: leaf component, off the hot path (home screen renders once).
  const { theme } = useUnistyles();
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const iconColor = accent ? theme.colors.accent : theme.colors.foregroundMuted;

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.tile,
      hovered && styles.tileHovered,
      pressed && styles.tilePressed,
    ],
    [hovered],
  );

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      testID={testID}
      style={pressableStyle}
    >
      <Icon size={20} color={iconColor} />
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}''', '''function HomeTile({ icon: Icon, title, description, onPress, testID, accent }: HomeTileProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      data-testid={testID}
      className="flex w-full flex-col items-start gap-3 rounded-[14px] border bg-card p-4 text-left hover:border-input hover:bg-muted active:opacity-85 md:min-h-[132px] md:w-[220px]"
    >
      <Icon size={20} className={cn("shrink-0", accent ? "text-primary" : "text-muted-foreground")} />
      <span className="flex flex-col gap-1">
        <span className="text-sm leading-[normal] text-foreground">{title}</span>
        <span className="text-sm leading-[18px] text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the home screen when no workspace is open; DOM view.", "open-project-screen.py")

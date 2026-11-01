// Override of packages/app/src/screens/open-project-screen.tsx: the home screen when no workspace is open; DOM view.
// Generated from the Expo file by web/scripts/port/open-project-screen.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { FolderOpen, Inbox, Plug, Smartphone } from "lucide-react";
import { cn } from "cn";
import { BySpaceLogo } from "@/components/icons/byspace-logo";
import { CommunityLinks } from "@/components/community-links";
import { MenuHeader } from "@/components/headers/menu-header";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useImportSession } from "@/hooks/use-import-session";
import { useHostChooser } from "@/hosts/host-chooser";
import { usePanelStore } from "@/stores/panel-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/settings/pair-device-modal";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";

export function OpenProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const openProjectPicker = useOpenAddProject();
  const importSession = useImportSession();
  const chooseHost = useHostChooser();
  const localServerId = useLocalDaemonServerId();
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);

  const isCompactLayout = useIsCompactFormFactor();

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  const handleOpenPicker = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  const handleOpenProviders = useCallback(() => {
    chooseHost({
      title: "Choose host",
      onChooseHost: (serverId) => {
        router.push(buildSettingsHostSectionRoute(serverId, "agents"));
      },
    });
  }, [chooseHost, router]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background select-none">
      <MenuHeader borderless />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="relative flex flex-1 flex-col items-center justify-start p-6 pt-12 md:justify-center md:pt-6 md:pb-[60px]">
          <div className="mb-8">
            <BySpaceLogo size={52} />
          </div>
          <div className="mt-6 flex w-full max-w-[452px] flex-row flex-wrap justify-start gap-3 md:mt-12">
            <HomeTile
              icon={FolderOpen}
              title={t("openProject.tiles.addProject.title")}
              description={t("openProject.tiles.addProject.description")}
              onPress={handleOpenPicker}
              testID="open-project-submit"
              accent
            />
            <HomeTile
              icon={Inbox}
              title={t("openProject.tiles.importSession.title")}
              description={t("openProject.tiles.importSession.description")}
              onPress={importSession.open}
              testID="open-project-import-session"
            />
            <HomeTile
              icon={Plug}
              title={t("openProject.tiles.setupProviders.title")}
              description={t("openProject.tiles.setupProviders.description")}
              onPress={handleOpenProviders}
              testID="open-project-setup-providers"
            />
            {localServerId ? (
              <HomeTile
                icon={Smartphone}
                title={t("openProject.tiles.pairDevice.title")}
                description={t("openProject.tiles.pairDevice.description")}
                onPress={handleOpenPairDevice}
                testID="open-project-pair-device"
              />
            ) : null}
          </div>
        </div>
        <div className="mb-[72px] flex shrink-0 flex-row items-center justify-center md:absolute md:inset-x-0 md:bottom-11 md:mb-0">
          <CommunityLinks />
        </div>
      </div>
      <PairDeviceModal
        serverId={localServerId ?? ""}
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
      {importSession.sheet}
    </div>
  );
}

interface HomeTileProps {
  icon: ComponentType<{ size: number; className?: string }>;
  title: string;
  description: string;
  onPress: () => void;
  testID?: string;
  accent?: boolean;
}

function HomeTile({ icon: Icon, title, description, onPress, testID, accent }: HomeTileProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      data-testid={testID}
      className="flex w-full flex-col items-start gap-3 rounded-[14px] border bg-card p-4 text-left hover:border-input hover:bg-muted active:opacity-85 md:min-h-[132px] md:w-[220px]"
    >
      <Icon
        size={20}
        className={cn("shrink-0", accent ? "text-primary" : "text-muted-foreground")}
      />
      <span className="flex flex-col gap-1">
        <span className="text-sm leading-[normal] text-foreground">{title}</span>
        <span className="text-sm leading-[18px] text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

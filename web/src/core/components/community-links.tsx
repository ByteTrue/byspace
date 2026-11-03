// Port of archive/expo-app:packages/app/src/components/community-links.tsx: Star, Sponsor and Community.
import { useCallback } from "react";
import { Heart } from "lucide-react";
import { Button } from "~/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { DiscordIcon } from "@/components/icons/discord-icon";
import { openExternalUrl } from "@/utils/open-external-url";

export function CommunityLinks() {
  const handleOpenGitHub = useCallback(() => {
    void openExternalUrl("https://github.com/ByteTrue/byspace");
  }, []);
  const handleOpenSponsor = useCallback(() => {
    void openExternalUrl("https://github.com/sponsors/boudra");
  }, []);
  const handleOpenDiscord = useCallback(() => {
    void openExternalUrl("https://discord.gg/jz8T2uahpH");
  }, []);

  return (
    <div className="flex items-center justify-center">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpenGitHub}
        data-testid="community-links-github-star"
      >
        <GitHubIcon color="currentColor" size={14} />
        Star
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpenSponsor}
        data-testid="community-links-sponsor"
      >
        <Heart data-icon="inline-start" />
        Sponsor
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpenDiscord}
        data-testid="community-links-discord"
      >
        <DiscordIcon color="currentColor" size={14} />
        Community
      </Button>
    </div>
  );
}

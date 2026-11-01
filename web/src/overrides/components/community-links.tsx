// Override of packages/app/src/components/community-links.tsx: Star, Sponsor and Community.
import { useCallback } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { DiscordIcon } from "@/components/icons/discord-icon";
import { openExternalUrl } from "@/utils/open-external-url";

const renderGitHubIcon = (color: string) => <GitHubIcon color={color} size={14} />;
const renderDiscordIcon = (color: string) => <DiscordIcon color={color} size={14} />;

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
        leftIcon={renderGitHubIcon}
        onPress={handleOpenGitHub}
        testID="community-links-github-star"
      >
        Star
      </Button>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Heart}
        onPress={handleOpenSponsor}
        testID="community-links-sponsor"
      >
        Sponsor
      </Button>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={renderDiscordIcon}
        onPress={handleOpenDiscord}
        testID="community-links-discord"
      >
        Community
      </Button>
    </div>
  );
}

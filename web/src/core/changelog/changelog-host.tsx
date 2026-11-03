// Port of packages/app/src/changelog/changelog-host.tsx: the same host, with the web sheet.
import { useChangelogStore } from "@/changelog/internal/changelog-store";
import { ChangelogSheet } from "@/changelog/internal/changelog-sheet";

/** Mounted once by the app shell so any surface can call `openChangelog()`. */
export function ChangelogHost() {
  const visible = useChangelogStore((state) => state.visible);
  const close = useChangelogStore((state) => state.close);

  return <ChangelogSheet visible={visible} onClose={close} />;
}

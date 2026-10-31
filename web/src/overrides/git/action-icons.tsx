// Override of packages/app/src/git/action-icons.tsx: the git action glyphs in the muted text colour.
import {
  Archive,
  ArrowDownUp,
  Download,
  GitCommitHorizontal,
  GitMerge,
  RefreshCcw,
  Upload,
} from "lucide-react";

const ICON_CLASS = "size-4 text-muted-foreground";

export const GIT_ACTION_ICONS = {
  commit: <GitCommitHorizontal className={ICON_CLASS} />,
  pull: <Download className={ICON_CLASS} />,
  push: <Upload className={ICON_CLASS} />,
  pullAndPush: <ArrowDownUp className={ICON_CLASS} />,
  merge: <GitMerge className={ICON_CLASS} />,
  mergeFromBase: <RefreshCcw className={ICON_CLASS} />,
  archive: <Archive className={ICON_CLASS} />,
};

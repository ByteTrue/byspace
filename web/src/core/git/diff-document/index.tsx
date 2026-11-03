// Port of packages/app/src/git/diff-document/index.tsx: unchanged but for `@/` imports.
// Converted from the Expo file by web/scripts/port/diff-document.py (tag archive/expo-app); edit it directly.
import { useCallback, useMemo, useRef, useState } from "react";
import { withUnistyles } from "react-native-unistyles";
import { RenderProfile } from "@/utils/render-profiler";
import { createDiffPalette, retainDiffPalette } from "@/git/diff-document/palette";
import { DiffSurface } from "@/git/diff-document/surface";
import type {
  DiffDocumentProps,
  DiffHeaderTypography,
  DiffPalette,
} from "@/git/diff-document/types";

export type { DiffDocumentProps, WorkingDiffMode } from "@/git/diff-document/types";

type ThemedDiffDocumentProps = DiffDocumentProps & {
  palette: DiffPalette;
  headerTypography: DiffHeaderTypography;
};

const EMPTY_PATHS: string[] = [];

function ThemedDiffDocument(props: ThemedDiffDocumentProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const paletteRef = useRef(props.palette);
  paletteRef.current = retainDiffPalette(paletteRef.current, props.palette);
  const palette = paletteRef.current;
  const collapseState = props.mode.kind === "working" ? props.collapseState : null;
  const paths = collapseState?.paths ?? EMPTY_PATHS;
  const collapsedFilePaths = useMemo(() => new Set(paths), [paths]);
  const toggleFile = useCallback(
    (path: string) => {
      if (!collapseState) return;
      const next = collapsedFilePaths.has(path)
        ? paths.filter((entry) => entry !== path)
        : [...paths, path];
      collapseState.onChange(next);
    },
    [collapseState, collapsedFilePaths, paths],
  );
  return (
    <DiffSurface
      {...props}
      palette={palette}
      collapsedFilePaths={collapsedFilePaths}
      onToggleFile={toggleFile}
      selectedPath={selectedPath}
      onSelectPath={setSelectedPath}
    />
  );
}

const StyledDiffDocument = withUnistyles(ThemedDiffDocument, (theme) => ({
  palette: createDiffPalette(theme),
  headerTypography: {
    family: theme.fontFamily.ui,
    size: theme.fontSize.base,
    statSize: theme.fontSize.sm,
  },
}));

export function DiffDocument(props: DiffDocumentProps) {
  return (
    <RenderProfile id="DiffDocument">
      <StyledDiffDocument {...props} />
    </RenderProfile>
  );
}

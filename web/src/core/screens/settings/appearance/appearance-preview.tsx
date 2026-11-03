// Port of packages/app/src/screens/settings/appearance/appearance-preview.tsx: a live preview of
// the content and code fonts and the syntax colours — a sentence in the content size, then a fixed
// TypeScript snippet as a unified diff. Draft values (still being typed) apply as inline overrides.
import { useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { HighlightToken } from "@bytetrue/highlight";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { DEFAULT_MONO_FONT_STACK } from "@/styles/theme";
import { tokenizeToLines } from "@/utils/highlight-cache";
import {
  CHANGED_LINE_INDICES,
  PREVIEW_AFTER,
  PREVIEW_BEFORE,
} from "@/screens/settings/appearance/preview-snippet";
import { cn } from "cn";
import { useThemeObject } from "~/app/theme-object";

const PREVIEW_EXTENSION = "ts";
// GitHub diff tints, as in git/diff-pane.tsx.
const REMOVED_TINT = "bg-[rgba(248,81,73,0.1)]";
const ADDED_TINT = "bg-[rgba(46,160,67,0.15)]";
// Zero-width space keeps blank lines at full line height.
const ZERO_WIDTH = "​";

type RowType = "context" | "add" | "remove";

interface PreviewOverrides {
  contentFontSize?: number;
  monoFontFamily?: string;
  codeFontSize?: number;
}

function resolveFamilyOverride(value: string | undefined, fallback: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

function resolveSizeOverride(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildCodeOverride(overrides: PreviewOverrides | undefined): CSSProperties {
  if (!overrides) return {};
  const style: CSSProperties = {};
  const fontFamily = resolveFamilyOverride(overrides.monoFontFamily, DEFAULT_MONO_FONT_STACK);
  if (fontFamily !== undefined) style.fontFamily = fontFamily;
  const fontSize = resolveSizeOverride(overrides.codeFontSize);
  if (fontSize !== undefined) {
    style.fontSize = fontSize;
    // The code line height follows the code size, as applyAppearance couples it.
    style.lineHeight = `${Math.round(fontSize * 1.5)}px`;
  }
  return style;
}

function buildContentOverride(overrides: PreviewOverrides | undefined): CSSProperties {
  const fontSize = resolveSizeOverride(overrides?.contentFontSize);
  if (fontSize === undefined) return {};
  return { fontSize, lineHeight: `${Math.round(fontSize * 1.4)}px` };
}

interface KeyedToken {
  key: string;
  style: string | null;
  text: string;
}

interface UnifiedRow {
  key: string;
  type: RowType;
  marker: string;
  tokens: KeyedToken[] | null;
  fallbackText: string;
}

function makeRow(
  key: string,
  type: RowType,
  marker: string,
  text: string,
  raw: HighlightToken[] | null,
): UnifiedRow {
  const tokens =
    raw && raw.length > 0
      ? raw.map((token, index) => ({
          key: `${key}-${index}`,
          style: token.style,
          text: token.text,
        }))
      : null;
  return { key, type, marker, tokens, fallbackText: text.length > 0 ? text : ZERO_WIDTH };
}

// Unchanged lines once as context; a changed line as "-" (before) then "+" (after).
function buildUnifiedRows(): UnifiedRow[] {
  const beforeLines = tokenizeToLines(PREVIEW_BEFORE.join("\n"), PREVIEW_EXTENSION);
  const afterLines = tokenizeToLines(PREVIEW_AFTER.join("\n"), PREVIEW_EXTENSION);
  const rows: UnifiedRow[] = [];
  for (let index = 0; index < PREVIEW_BEFORE.length; index += 1) {
    if (CHANGED_LINE_INDICES.has(index)) {
      rows.push(
        makeRow(`r-${index}`, "remove", "- ", PREVIEW_BEFORE[index], beforeLines?.[index] ?? null),
      );
      rows.push(
        makeRow(`a-${index}`, "add", "+ ", PREVIEW_AFTER[index], afterLines?.[index] ?? null),
      );
    } else {
      rows.push(
        makeRow(`c-${index}`, "context", "  ", PREVIEW_BEFORE[index], beforeLines?.[index] ?? null),
      );
    }
  }
  return rows;
}

const ROW_TINT: Record<RowType, string | null> = {
  add: ADDED_TINT,
  remove: REMOVED_TINT,
  context: null,
};

export function AppearancePreview({ overrides }: { overrides?: PreviewOverrides }) {
  const { t } = useTranslation();
  const rows = useMemo(() => buildUnifiedRows(), []);
  const contentOverride = useMemo(() => buildContentOverride(overrides), [overrides]);
  const codeOverride = useMemo(() => buildCodeOverride(overrides), [overrides]);
  // The markers follow the theme's diff colours, which shadcn has no token for.
  const { colors } = useThemeObject();
  const markerStyles = useMemo<Record<RowType, CSSProperties>>(
    () => ({
      add: { color: colors.diffAddition },
      remove: { color: colors.diffDeletion },
      context: { color: colors.foregroundMuted },
    }),
    [colors.diffAddition, colors.diffDeletion, colors.foregroundMuted],
  );

  return (
    <div
      role="img"
      aria-label={t("settings.appearance.syntax.previewAccessibility")}
      className="code-surface flex flex-col overflow-hidden rounded-[10px] border bg-card py-2"
    >
      <span
        className="px-3 pb-2 text-[length:var(--content-font-size)] leading-[round(calc(var(--content-font-size)*1.4),1px)] text-foreground"
        style={contentOverride}
      >
        {t("settings.appearance.syntax.previewContent")}
      </span>
      {rows.map((row) => (
        <div key={row.key} className={cn("px-3", ROW_TINT[row.type])}>
          <span
            className="block font-mono text-[length:var(--code-font-size)] leading-[round(calc(var(--code-font-size)*1.5),1px)] [overflow-wrap:normal] whitespace-pre text-foreground"
            style={codeOverride}
          >
            <span style={markerStyles[row.type]}>{row.marker}</span>
            {row.tokens
              ? row.tokens.map((token) => (
                  <span
                    key={token.key}
                    style={token.style ? syntaxTokenStyleFor(token.style) : undefined}
                  >
                    {token.text}
                  </span>
                ))
              : row.fallbackText}
          </span>
        </div>
      ))}
    </div>
  );
}

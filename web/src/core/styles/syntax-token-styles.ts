// Port of archive/expo-app:packages/app/src/styles/syntax-token-styles.ts. The colours come from the theme's
// syntax palette, which AppearanceProvider writes to <html> as --syntax-<token> variables.
import type { CSSProperties } from "react";

const TOKENS = [
  "keyword",
  "comment",
  "string",
  "number",
  "literal",
  "function",
  "definition",
  "class",
  "type",
  "tag",
  "attribute",
  "property",
  "variable",
  "operator",
  "punctuation",
  "regexp",
  "escape",
  "meta",
  "heading",
  "link",
] as const;

export const syntaxTokenStyles: Record<string, CSSProperties> = {
  base: { color: "var(--foreground)" },
  ...Object.fromEntries(TOKENS.map((token) => [token, { color: `var(--syntax-${token})` }])),
};

// Accepts a plain string so diff tokens (server-typed `string | null`) and
// @bytetrue/highlight tokens (typed `HighlightStyle | null`) share one path.
// Unknown styles fall back to the base color.
export function syntaxTokenStyleFor(style: string | null | undefined): CSSProperties {
  if (!style) return syntaxTokenStyles.base;
  return syntaxTokenStyles[style] ?? syntaxTokenStyles.base;
}

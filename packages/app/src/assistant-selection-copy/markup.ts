export const MARKDOWN_COPY_TAG_ATTRIBUTE = "data-byspace-markdown-tag";
export const MARKDOWN_COPY_IGNORE_ATTRIBUTE = "data-byspace-markdown-ignore";
export const MARKDOWN_COPY_UNWRAP_ATTRIBUTE = "data-byspace-markdown-unwrap";
export const MARKDOWN_COPY_LIST_START_ATTRIBUTE = "data-byspace-markdown-list-start";
export const MARKDOWN_COPY_LANGUAGE_ATTRIBUTE = "data-byspace-markdown-language";
export const MARKDOWN_COPY_ALIGN_ATTRIBUTE = "data-byspace-markdown-align";

/**
 * Trailing line breaks, with any indentation that followed the last one.
 *
 * Both ways of copying code strip these, for the same reason: pasting a trailing
 * newline into a terminal runs the last line. A fence body always ends in one, and
 * ends in several when the author left blank lines before the closing fence; a
 * selection picks one up whenever it overshoots the end of a rendered line.
 */
export const TRAILING_CODE_LINE_BREAKS = /(\r?\n[ \t]*)+$/;

export const markdownCopyDataSet = {
  blockquote: { byspaceMarkdownTag: "blockquote" },
  br: { byspaceMarkdownTag: "br" },
  code: { byspaceMarkdownTag: "code" },
  h1: { byspaceMarkdownTag: "h1" },
  h2: { byspaceMarkdownTag: "h2" },
  h3: { byspaceMarkdownTag: "h3" },
  h4: { byspaceMarkdownTag: "h4" },
  h5: { byspaceMarkdownTag: "h5" },
  h6: { byspaceMarkdownTag: "h6" },
  hr: { byspaceMarkdownTag: "hr" },
  ignore: { byspaceMarkdownIgnore: "true" },
  li: { byspaceMarkdownTag: "li" },
  ol: { byspaceMarkdownTag: "ol" },
  p: { byspaceMarkdownTag: "p" },
  pre: { byspaceMarkdownTag: "pre" },
  s: { byspaceMarkdownTag: "s" },
  strong: { byspaceMarkdownTag: "strong" },
  em: { byspaceMarkdownTag: "em" },
  table: { byspaceMarkdownTag: "table" },
  tbody: { byspaceMarkdownTag: "tbody" },
  td: { byspaceMarkdownTag: "td" },
  th: { byspaceMarkdownTag: "th" },
  thead: { byspaceMarkdownTag: "thead" },
  tr: { byspaceMarkdownTag: "tr" },
  ul: { byspaceMarkdownTag: "ul" },
  unwrap: { byspaceMarkdownUnwrap: "true" },
} as const;

export type MarkdownCopyInlineTag = "br" | "code" | "em" | "s" | "strong";

export function markdownCopyOrderedListDataSet(start: unknown) {
  return {
    ...markdownCopyDataSet.ol,
    byspaceMarkdownListStart: String(start ?? 1),
  } as const;
}

export function markdownCopyCodeBlockDataSet(language: string | null | undefined) {
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  return {
    ...markdownCopyDataSet.pre,
    ...(fenceLanguage ? { byspaceMarkdownLanguage: fenceLanguage } : {}),
  } as const;
}

export function markdownCopyTableCellDataSet(tag: "td" | "th", style: unknown) {
  const alignment =
    typeof style === "string"
      ? style.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]
      : null;
  return {
    ...markdownCopyDataSet[tag],
    ...(alignment ? { byspaceMarkdownAlign: alignment.toLowerCase() } : {}),
  } as const;
}

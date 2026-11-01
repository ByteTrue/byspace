// Override of packages/app/src/components/highlighted-code-block.tsx: a fenced code block with
// @bytetrue/highlight colours and a copy button that shows on hover (always on a phone). The box
// is the `.markdown pre` style; `variant` picks the fence or indented-block margins.
import * as Clipboard from "expo-clipboard";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  MARKDOWN_COPY_IGNORE_ATTRIBUTE,
  MARKDOWN_COPY_LANGUAGE_ATTRIBUTE,
  TRAILING_CODE_LINE_BREAKS,
} from "@/assistant-selection-copy/markup";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { highlightToKeyedLines, type KeyedLine } from "@/utils/highlight-cache";
import { cn } from "cn";
import { copyTag } from "~/markdown/render";

// Fence info strings ("```ts", "```typescript", "```ts {1,3}") map to the
// extension-based parser table in @bytetrue/highlight. Aliases here only
// cover names that don't already match an extension key in parsers.ts.
const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  golang: "go",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  objc: "m",
  "objective-c": "m",
  markdown: "md",
  elixir: "ex",
};

function fenceLanguageToExtension(info: string | null | undefined): string | null {
  if (!info) return null;
  const first = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return null;
  const normalized = first.replace(/^\./, "");
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function stripTerminalFenceNewline(code: string): string {
  return code.endsWith("\n") ? code.slice(0, -1) : code;
}

function renderCodeSegments(keyedLines: KeyedLine[]): ReactNode[] {
  const segments: ReactNode[] = [];
  keyedLines.forEach((line, lineIndex) => {
    if (lineIndex > 0) segments.push("\n");
    for (const { key, token } of line.tokens) {
      segments.push(
        <span
          key={`${line.key}-${key}`}
          style={token.style ? syntaxTokenStyleFor(token.style) : undefined}
        >
          {token.text}
        </span>,
      );
    }
  });
  return segments;
}

const COPIED_RESET_MS = 1500;
const IGNORE_FOR_COPY = { [MARKDOWN_COPY_IGNORE_ATTRIBUTE]: "true" };

function CopyButton({ getCode }: { getCode: () => string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );
  const handleClick = useCallback(async () => {
    const content = getCode();
    if (!content) return;
    await Clipboard.setStringAsync(content);
    setCopied(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopied(false);
      resetRef.current = null;
    }, COPIED_RESET_MS);
  }, [getCode]);
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={copied ? t("message.actions.copied") : t("message.actions.copyCode")}
      className="absolute top-2 right-2 rounded-sm p-1 text-muted-foreground opacity-0 outline-none group-hover/code:opacity-100 hover:text-foreground focus-visible:opacity-100 max-md:opacity-100"
      {...IGNORE_FOR_COPY}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export const HighlightedCodeBlock = memo(function HighlightedCodeBlock({
  code,
  language,
  variant = "fence",
  className,
}: {
  code: string;
  language: string | null | undefined;
  variant?: "fence" | "code_block";
  className?: string;
}) {
  const renderedCode = useMemo(() => stripTerminalFenceNewline(code), [code]);
  const keyedLines = useMemo(
    () => highlightToKeyedLines(renderedCode, fenceLanguageToExtension(language)),
    [renderedCode, language],
  );
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  // Copy the code without its trailing blank lines. A fence body ends in a newline,
  // and ends in more than one when the author left a blank line before the closing
  // fence; pasting any of them into a terminal runs the last line.
  const getCode = useCallback(() => code.replace(TRAILING_CODE_LINE_BREAKS, ""), [code]);
  return (
    <pre
      className={cn("group/code", variant === "code_block" && "md-code-block", className)}
      data-pmono=""
      {...copyTag("pre")}
      {...(fenceLanguage ? { [MARKDOWN_COPY_LANGUAGE_ATTRIBUTE]: fenceLanguage } : {})}
    >
      <code {...copyTag("code")}>{keyedLines ? renderCodeSegments(keyedLines) : renderedCode}</code>
      <CopyButton getCode={getCode} />
    </pre>
  );
});

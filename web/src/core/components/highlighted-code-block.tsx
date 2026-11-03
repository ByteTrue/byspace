// A fenced code block: shadcn's CodeBlock with @bytetrue/highlight colours and its copy button.
// `variant` picks the fence or indented-block margins.
import { memo, useMemo, type ReactNode } from "react";
import {
  MARKDOWN_COPY_IGNORE_ATTRIBUTE,
  MARKDOWN_COPY_LANGUAGE_ATTRIBUTE,
  TRAILING_CODE_LINE_BREAKS,
} from "@/assistant-selection-copy/markup";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { highlightToKeyedLines, type KeyedLine } from "@/utils/highlight-cache";
import { cn } from "cn";
import { copyTag } from "~/markdown/render";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from "~/components/ui/code-block";

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

// Each line ends in its newline (but the last), so copied text keeps its lines: the selection copy
// reads text, not layout. A newline at the end of a block line draws nothing.
function renderCodeLines(keyedLines: KeyedLine[]): ReactNode[] {
  return keyedLines.map((line, index) => (
    <CodeBlockLine key={line.key}>
      {line.tokens.map(({ key, token }) => (
        <span key={key} style={token.style ? syntaxTokenStyleFor(token.style) : undefined}>
          {token.text}
        </span>
      ))}
      {index < keyedLines.length - 1 ? "\n" : null}
    </CodeBlockLine>
  ));
}

const IGNORE_FOR_COPY = { [MARKDOWN_COPY_IGNORE_ATTRIBUTE]: "true" };

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
  const copyValue = useMemo(() => code.replace(TRAILING_CODE_LINE_BREAKS, ""), [code]);
  return (
    <CodeBlock className={cn(variant === "code_block" ? "my-2" : "my-3", className)}>
      <CodeBlockActions>
        <CodeBlockCopyButton value={copyValue} {...IGNORE_FOR_COPY} />
      </CodeBlockActions>
      <CodeBlockContent
        className="text-(length:--md-code-size)"
        {...copyTag("pre")}
        {...(fenceLanguage ? { [MARKDOWN_COPY_LANGUAGE_ATTRIBUTE]: fenceLanguage } : {})}
      >
        {/* The copy tag the selection copy reads; `contents` keeps the lines CodeBlock's rows. */}
        <span className="contents" {...copyTag("code")}>
          {keyedLines ? renderCodeLines(keyedLines) : renderedCode}
        </span>
      </CodeBlockContent>
    </CodeBlock>
  );
});

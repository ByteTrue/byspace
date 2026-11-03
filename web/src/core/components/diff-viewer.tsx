// Port of packages/app/src/components/diff-viewer.tsx: an edit's lines on tinted rows, word
// changes highlighted, scrolling both ways inside a capped height.
import { memo, useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { diffLinePrefix } from "@/utils/diff-highlight";
import type { DiffLine } from "@/utils/tool-call-parsers";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { cn } from "cn";

const ROW_TINT: Partial<Record<DiffLine["type"], string>> = {
  header: "bg-card",
  add: "bg-[rgba(46,160,67,0.15)]",
  remove: "bg-[rgba(248,81,73,0.1)]",
  context: "bg-card",
};

function DiffLineTokens({ tokens }: { tokens: NonNullable<DiffLine["tokens"]> }) {
  const keyedTokens = useMemo(
    () => tokens.map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );
  return (
    <>
      {keyedTokens.map(({ key, token }) => (
        <span key={key} style={token.style ? syntaxTokenStyleFor(token.style) : undefined}>
          {token.text}
        </span>
      ))}
    </>
  );
}

const DiffLineRow = memo(function DiffLineRow({ line }: { line: DiffLine }) {
  const muted = line.type === "header" || line.type === "context";
  let content: React.ReactNode;
  if (line.tokens) {
    content = (
      <>
        <span className={line.type === "context" ? "text-muted-foreground" : undefined}>
          {diffLinePrefix(line)}
        </span>
        <DiffLineTokens tokens={line.tokens} />
      </>
    );
  } else if (line.segments) {
    const changed = line.type === "add" ? "bg-[rgba(46,160,67,0.4)]" : "bg-[rgba(248,81,73,0.35)]";
    content = (
      <>
        {line.content[0]}
        {line.segments.map((segment) => (
          <span
            key={`${segment.changed ? "c" : "u"}:${segment.text}`}
            className={segment.changed ? changed : undefined}
          >
            {segment.text}
          </span>
        ))}
      </>
    );
  } else {
    content = <span className={muted ? "text-muted-foreground" : undefined}>{line.content}</span>;
  }
  return (
    <div className={cn("min-w-full py-1 whitespace-pre text-foreground", ROW_TINT[line.type])}>
      {content}
    </div>
  );
});

export function DiffViewer({
  diffLines,
  maxHeight,
  emptyLabel,
  fillAvailableHeight = false,
}: {
  diffLines: DiffLine[];
  maxHeight?: number;
  emptyLabel?: string;
  fillAvailableHeight?: boolean;
}) {
  const { t } = useTranslation();
  const keyedDiffLines = useMemo(
    () => diffLines.map((line, index) => ({ key: `${index}-${line.type}-${line.content}`, line })),
    [diffLines],
  );
  const scrollStyle = useMemo<CSSProperties | undefined>(
    () => (maxHeight !== undefined ? { maxHeight } : undefined),
    [maxHeight],
  );
  if (!diffLines.length) {
    return (
      <div className="flex items-center justify-center p-4">
        <span className="text-sm text-muted-foreground">{emptyLabel ?? t("diffViewer.empty")}</span>
      </div>
    );
  }
  return (
    <div
      className={cn("overflow-auto", fillAvailableHeight && "min-h-0 flex-1")}
      style={scrollStyle}
    >
      <div
        className="w-max min-w-full p-3 pb-6 font-mono text-(length:--code-font-size)"
        data-pmono=""
      >
        {keyedDiffLines.map(({ key, line }) => (
          <DiffLineRow key={key} line={line} />
        ))}
      </div>
    </div>
  );
}

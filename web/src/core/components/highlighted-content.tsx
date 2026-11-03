// Port of archive/expo-app:packages/app/src/components/highlighted-content.tsx: pre-tokenized code lines, with
// an optional line-number gutter (Read carries a server-normalized offset).
import { memo } from "react";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import type { KeyedLine } from "@/utils/highlight-cache";

// Same 18px line as the plain fallback in tool-call details, so blank lines keep their height.
const ZERO_WIDTH = "\u200b";

function ContentLine({ line }: { line: KeyedLine }) {
  return (
    <span className="block whitespace-pre text-muted-foreground">
      {line.tokens.length === 0
        ? ZERO_WIDTH
        : line.tokens.map(({ key, token }) => (
            <span key={key} style={token.style ? syntaxTokenStyleFor(token.style) : undefined}>
              {token.text}
            </span>
          ))}
    </span>
  );
}

const GutteredLine = memo(function GutteredLine({
  line,
  lineNumber,
  digits,
}: {
  line: KeyedLine;
  lineNumber: number;
  digits: number;
}) {
  return (
    <div className="flex min-h-[18px]">
      <span className="shrink-0 whitespace-pre text-muted-foreground opacity-60 select-none">
        {String(lineNumber).padStart(digits)}{" "}
      </span>
      <ContentLine line={line} />
    </div>
  );
});

export function HighlightedLines({ lines, startLine }: { lines: KeyedLine[]; startLine?: number }) {
  if (startLine === undefined) {
    return (
      <div className="tool-code" data-pmono="">
        {lines.map((line) => (
          <ContentLine key={line.key} line={line} />
        ))}
      </div>
    );
  }
  const lastLineNumber = startLine + lines.length - 1;
  const digits = Math.max(2, String(lastLineNumber).length);
  return (
    <div className="tool-code" data-pmono="">
      {lines.map((line, index) => (
        <GutteredLine key={line.key} line={line} lineNumber={startLine + index} digits={digits} />
      ))}
    </div>
  );
}

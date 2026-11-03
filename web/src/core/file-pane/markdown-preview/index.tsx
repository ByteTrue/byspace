// Port of packages/app/src/file-pane/markdown-preview/index.tsx: a Markdown file rendered for
// reading, its front matter as a key/value table above the body.
import { useMemo } from "react";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { parseMarkdownPreviewDocument } from "@/file-pane/markdown-preview/document";

const READING_FRAME_STYLE = { maxWidth: MAX_CONTENT_WIDTH };

export function FileMarkdownPreview({ source }: { source: string }) {
  const document = useMemo(() => parseMarkdownPreviewDocument(source), [source]);
  return (
    <div className="w-full px-3 py-4 md:px-4">
      <div className="mx-auto w-full px-2" style={READING_FRAME_STYLE}>
        {document.frontMatter.length > 0 ? (
          <div
            className="mb-6 overflow-hidden rounded-lg border"
            data-testid="markdown-front-matter"
          >
            {document.frontMatter.map((row, index) => (
              <div key={row.key} className={index > 0 ? "flex border-t" : "flex"}>
                <div className="max-w-[180px] basis-[30%] bg-muted px-3 py-2 font-mono text-sm leading-5 text-muted-foreground">
                  {row.key}
                </div>
                <div className="min-w-0 flex-1 px-3 py-2 text-sm leading-5 text-foreground">
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <MarkdownRenderer text={document.body} />
      </div>
    </div>
  );
}

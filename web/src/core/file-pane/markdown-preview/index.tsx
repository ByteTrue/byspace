// Port of archive/expo-app:packages/app/src/file-pane/markdown-preview/index.tsx: a Markdown file rendered for
// reading, its front matter as a key/value table above the body.
import { useMemo } from "react";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { parseMarkdownPreviewDocument } from "@/file-pane/markdown-preview/document";
import { Table, TableBody, TableCell, TableRow } from "~/components/ui/table";

const READING_FRAME_STYLE = { maxWidth: MAX_CONTENT_WIDTH };

export function FileMarkdownPreview({ source }: { source: string }) {
  const document = useMemo(() => parseMarkdownPreviewDocument(source), [source]);
  return (
    <div className="w-full px-3 py-4 md:px-4">
      <div className="mx-auto w-full px-2" style={READING_FRAME_STYLE}>
        {document.frontMatter.length > 0 ? (
          <Table className="mb-6" data-testid="markdown-front-matter">
            <TableBody>
              {document.frontMatter.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="w-[30%] max-w-[180px] font-mono text-muted-foreground">
                    {row.key}
                  </TableCell>
                  <TableCell className="whitespace-normal">{row.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        <MarkdownRenderer text={document.body} />
      </div>
    </div>
  );
}

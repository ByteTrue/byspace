// Port of archive/expo-app:packages/app/src/components/markdown/fence/index.tsx: mermaid fences draw the
// diagram, every other fence is a highlighted code block.
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { getMarkdownFenceLanguage } from "@/components/markdown/fence/language";
import { MermaidFenceHost } from "@/components/markdown/fence/mermaid/host";
import type { MarkdownPhase } from "@/components/markdown/fence/types";

export function MarkdownFenceBlock({
  code,
  info,
  phase,
}: {
  code: string;
  info: string | null | undefined;
  phase: MarkdownPhase;
}) {
  const language = getMarkdownFenceLanguage(info);
  if (language === "mermaid") return <MermaidFenceHost code={code} phase={phase} />;
  return <HighlightedCodeBlock code={code} language={language} />;
}

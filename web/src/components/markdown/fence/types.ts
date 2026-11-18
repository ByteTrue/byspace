import type { CSSProperties } from "react";

export type MarkdownPhase = "streaming" | "complete";

export interface MarkdownFenceRendererProps {
  code: string;
  phase: MarkdownPhase;
  inheritedStyles: CSSProperties;
  textStyle: CSSProperties;
}

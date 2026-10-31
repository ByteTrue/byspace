import MarkdownIt from "markdown-it";
import { useMemo } from "react";
import { cn } from "cn";

// html: false escapes raw HTML in agent output, and markdown-it's default link validation drops
// javascript: and other unsafe URLs, so the rendered string is safe to inject.
const markdown = new MarkdownIt({ html: false, linkify: true });
const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noreferrer noopener");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// shortcut: markdown renders to an HTML string; file links, code highlighting, mermaid and the
// copy button come with the React renderer in step 3 of the rewrite epic.
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => ({ __html: markdown.render(text) }), [text]);
  return <div className={cn("markdown", className)} dangerouslySetInnerHTML={html} />;
}

// Renders the markdown node tree (./ast.ts) as DOM. Every element carries the copy markers the
// Expo renderer put on its views (assistant-selection-copy/markup.ts), so selection copy turns a
// rendered selection back into markdown the same way. Styles live in index.css under `.markdown`
// and mirror archive/expo-app:packages/app/src/styles/markdown-styles.ts.
import { Fragment, type CSSProperties, type ReactNode } from "react";
import {
  MARKDOWN_COPY_ALIGN_ATTRIBUTE,
  MARKDOWN_COPY_IGNORE_ATTRIBUTE,
  MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE,
  MARKDOWN_COPY_LIST_START_ATTRIBUTE,
  MARKDOWN_COPY_TAG_ATTRIBUTE,
} from "@/assistant-selection-copy/markup";
import { getMarkdownListMarker, getMarkdownListSpacing } from "@/utils/markdown-list";
import { cn } from "cn";
import type { MarkdownAstNode } from "./ast";

export type MarkdownRule = (
  node: MarkdownAstNode,
  children: ReactNode[],
  parents: MarkdownAstNode[],
) => ReactNode;

export type MarkdownRules = Partial<Record<string, MarkdownRule>>;

export function copyTag(tag: string) {
  return { [MARKDOWN_COPY_TAG_ATTRIBUTE]: tag };
}

const LIST_MARKER_ATTRIBUTES = {
  [MARKDOWN_COPY_IGNORE_ATTRIBUTE]: "true",
  [MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE]: "true",
};

// A column's `:---:` / `---:` alignment. The Expo app read it for copying only, so aligned columns
// rendered left-aligned; the cell now applies it.
type CellAlign = "left" | "right" | "center";

const CELL_ALIGN_STYLES: Record<CellAlign, CSSProperties> = {
  left: { textAlign: "left" },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
};

function cellAlignment(style: string | undefined): CellAlign | null {
  const align = style?.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]?.toLowerCase();
  return align === "left" || align === "right" || align === "center" ? align : null;
}

function listSpacingStyle(node: MarkdownAstNode, parents: MarkdownAstNode[]): CSSProperties {
  return getMarkdownListSpacing(node, parents);
}

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

export const DEFAULT_MARKDOWN_RULES: Record<string, MarkdownRule> = {
  ...Object.fromEntries(
    HEADINGS.map((tag, index) => [
      `heading${index + 1}`,
      ((node, children) => {
        const Heading = tag;
        return (
          <Heading key={node.key} {...copyTag(tag)}>
            {children}
          </Heading>
        );
      }) satisfies MarkdownRule,
    ]),
  ),
  // A div, not a <p>: paragraphs can hold block content (an agent's images).
  paragraph: (node, children) => (
    <div key={node.key} className="md-p" {...copyTag("p")}>
      {children}
    </div>
  ),
  text: (node) => <Fragment key={node.key}>{node.content}</Fragment>,
  inline: (node, children) => <Fragment key={node.key}>{children}</Fragment>,
  strong: (node, children) => (
    <strong key={node.key} {...copyTag("strong")}>
      {children}
    </strong>
  ),
  em: (node, children) => (
    <em key={node.key} {...copyTag("em")}>
      {children}
    </em>
  ),
  s: (node, children) => (
    <s key={node.key} {...copyTag("s")}>
      {children}
    </s>
  ),
  // The Expo app's hardbreak is an 8px-tall full-width block: a new line plus 8px.
  hardbreak: (node) => <span key={node.key} className="md-hardbreak" {...copyTag("br")} />,
  // A soft break is a line break here too: the Expo renderer emitted "\n" into pre-wrapped text.
  softbreak: (node) => <Fragment key={node.key}>{"\n"}</Fragment>,
  code_inline: (node) => (
    <code key={node.key} data-pmono="" {...copyTag("code")}>
      {node.content}
    </code>
  ),
  code_block: (node) => (
    <pre key={node.key} data-pmono="" {...copyTag("pre")}>
      <code {...copyTag("code")}>{node.content.replace(/\n$/, "")}</code>
    </pre>
  ),
  fence: (node) => (
    <pre key={node.key} data-pmono="" {...copyTag("pre")}>
      <code {...copyTag("code")}>{node.content.replace(/\n$/, "")}</code>
    </pre>
  ),
  link: (node, children) => (
    <a
      key={node.key}
      href={node.attributes.href}
      title={node.attributes.title}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  ),
  blocklink: (node, children) => (
    <a key={node.key} href={node.attributes.href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  image: (node) => (
    <img key={node.key} src={node.attributes.src} alt={node.attributes.alt} className="md-image" />
  ),
  blockquote: (node, children) => (
    <blockquote key={node.key} {...copyTag("blockquote")}>
      {children}
    </blockquote>
  ),
  hr: (node) => <hr key={node.key} {...copyTag("hr")} />,
  bullet_list: (node, children, parents) => (
    <ul key={node.key} style={listSpacingStyle(node, parents)} {...copyTag("ul")}>
      {children}
    </ul>
  ),
  ordered_list: (node, children, parents) => (
    <ol
      key={node.key}
      start={Number.parseInt(node.attributes.start ?? "1", 10) || 1}
      style={listSpacingStyle(node, parents)}
      {...copyTag("ol")}
      {...{ [MARKDOWN_COPY_LIST_START_ATTRIBUTE]: node.attributes.start ?? "1" }}
    >
      {children}
    </ol>
  ),
  list_item: (node, children, parents) => {
    const { isOrdered, marker } = getMarkdownListMarker(node, parents);
    return (
      <li key={node.key} {...copyTag("li")}>
        <span
          className={cn("md-marker", isOrdered && "md-marker-ordered")}
          {...LIST_MARKER_ATTRIBUTES}
        >
          {marker}
        </span>
        <div className="md-li-content">{children}</div>
      </li>
    );
  },
  table: (node, children) => (
    <div key={node.key} className="md-table">
      <table {...copyTag("table")}>{children}</table>
    </div>
  ),
  thead: (node, children) => (
    <thead key={node.key} {...copyTag("thead")}>
      {children}
    </thead>
  ),
  tbody: (node, children) => (
    <tbody key={node.key} {...copyTag("tbody")}>
      {children}
    </tbody>
  ),
  tr: (node, children) => (
    <tr key={node.key} {...copyTag("tr")}>
      {children}
    </tr>
  ),
  th: (node, children) => {
    const align = cellAlignment(node.attributes.style);
    return (
      <th
        key={node.key}
        style={align ? CELL_ALIGN_STYLES[align] : undefined}
        {...copyTag("th")}
        {...(align ? { [MARKDOWN_COPY_ALIGN_ATTRIBUTE]: align } : {})}
      >
        {children}
      </th>
    );
  },
  td: (node, children) => {
    const align = cellAlignment(node.attributes.style);
    return (
      <td
        key={node.key}
        style={align ? CELL_ALIGN_STYLES[align] : undefined}
        {...copyTag("td")}
        {...(align ? { [MARKDOWN_COPY_ALIGN_ATTRIBUTE]: align } : {})}
      >
        {children}
      </td>
    );
  },
  unknown: () => null,
};

function renderNode(
  node: MarkdownAstNode,
  parents: MarkdownAstNode[],
  rules: MarkdownRules,
): ReactNode {
  const childParents = [node, ...parents];
  const children = node.children.map((child) => renderNode(child, childParents, rules));
  const rule =
    rules[node.type] ?? DEFAULT_MARKDOWN_RULES[node.type] ?? DEFAULT_MARKDOWN_RULES.unknown;
  return rule(node, children, parents);
}

export function renderMarkdownNodes(
  nodes: MarkdownAstNode[],
  rules: MarkdownRules = {},
): ReactNode[] {
  return nodes.map((node) => renderNode(node, [], rules));
}

/** The markdown body: one column, prose type, block margins that add up instead of collapsing. */
export function MarkdownBody({
  nodes,
  rules,
  compact = false,
  className,
}: {
  nodes: MarkdownAstNode[];
  rules?: MarkdownRules;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("markdown", compact && "markdown-compact", className)}>
      {renderMarkdownNodes(nodes, rules)}
    </div>
  );
}

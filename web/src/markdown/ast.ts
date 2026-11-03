// markdown-it tokens to the node tree the Expo app's renderer worked on (react-native-markdown-display,
// MIT): same node types (`heading1`…, `bullet_list`, `list_item`, `fence`, …), the same `key`,
// `index`, `markup`, `sourceInfo`, `sourceType` and `attributes`, and the same pruning of the
// paragraph that opens a list item. Shared helpers (list markers and spacing, link sources) read
// these fields, so the web renderer keeps them.
import type MarkdownIt from "markdown-it";

type Token = ReturnType<MarkdownIt["parse"]>[number];

export interface MarkdownAstNode {
  type: string;
  sourceType: string;
  sourceInfo: string;
  sourceMeta: unknown;
  block: boolean;
  markup: string;
  key: string;
  content: string;
  index: number;
  attributes: Record<string, string>;
  children: MarkdownAstNode[];
}

function tokenType(token: Token): string {
  const type = token.type.replace(/_open|_close/g, "");
  return type === "heading" ? `heading${token.tag.slice(1)}` : type;
}

/** Inline tokens are spliced into the block stream, as the Expo renderer did. */
function flattenInline(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    if (token.type === "inline" && token.children && token.children.length > 0) {
      out.push(...flattenInline(token.children));
    } else {
      out.push(token);
    }
  }
  return out;
}

function inlineText(tokens: Token[] | null): string {
  let text = "";
  for (const token of tokens ?? []) {
    if (token.type === "text") text += token.content;
    else if (token.type === "image") text += inlineText(token.children);
  }
  return text;
}

/** Drops the paragraph that directly opens a list item, keeping later ones. */
function omitListItemParagraph(tokens: Token[]): Token[] {
  let depth: number | null = null;
  return tokens.filter((token, index) => {
    if (depth !== null) depth += token.nesting;
    if (token.type === "list_item_open" && depth === null) {
      const next = tokens[index + 1];
      if (next && next.type === "paragraph_open") depth = 0;
      return true;
    }
    if (token.type === "paragraph_open" && depth === 1) return false;
    if (token.type === "paragraph_close" && depth === 0) {
      depth = null;
      return false;
    }
    return true;
  });
}

function createNode(token: Token, tokenIndex: number, parentKey: string): MarkdownAstNode {
  const type = tokenType(token);
  const keyPath = parentKey ? `${parentKey}.${tokenIndex}` : `${tokenIndex}`;
  const attributes: Record<string, string> = {};
  for (const [name, value] of token.attrs ?? []) attributes[name] = value;
  if (type === "image") attributes.alt = inlineText(token.children);
  return {
    type,
    sourceType: token.type,
    sourceInfo: token.info,
    sourceMeta: token.meta,
    block: token.block || type === "image" || type === "hardbreak",
    markup: token.markup,
    key: `rnmr_${keyPath}_${type}`,
    content: token.content,
    index: 0,
    attributes,
    // Images keep their alt tokens out of the tree, as the Expo renderer's did.
    children: type === "image" ? [] : buildTree(token.children ?? [], keyPath),
  };
}

function buildTree(tokens: Token[], parentKey: string): MarkdownAstNode[] {
  const stack: MarkdownAstNode[][] = [];
  let children: MarkdownAstNode[] = [];
  tokens.forEach((token, index) => {
    const node = createNode(token, index, parentKey);
    if (node.type === "text" && node.children.length === 0 && node.content === "") return;
    node.index = children.length;
    if (token.nesting === 1) {
      children.push(node);
      stack.push(children);
      children = node.children;
    } else if (token.nesting === -1) {
      children = stack.pop() ?? children;
    } else {
      children.push(node);
    }
  });
  return children;
}

export function parseMarkdownAst(source: string, parser: MarkdownIt): MarkdownAstNode[] {
  let tokens: Token[];
  try {
    tokens = parser.parse(source, {});
  } catch {
    return [];
  }
  return buildTree(omitListItemParagraph(flattenInline(tokens)), "");
}

export function markdownNodeText(node: MarkdownAstNode): string {
  if (node.children.length === 0) return node.content ?? "";
  return node.children.map(markdownNodeText).join("");
}

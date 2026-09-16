export interface ParsedNotificationMessage {
  title: string | null;
  body: string | null;
}

/**
 * Parses notification text into structured title and body components.
 * Strips raw Markdown heading markers (e.g. `## `, `# `, `**bold**`) and
 * extracts a clean title and optional body.
 */
export function parseNotificationMessage(rawMessage: string): ParsedNotificationMessage {
  const message = rawMessage.trim();
  if (!message) {
    return { title: null, body: null };
  }

  // 1. Explicit Markdown heading at the start: e.g. "## Historian recovery\n\nBody" or "# Title"
  const headingMatch = message.match(/^#{1,6}\s+([^\n]+)(?:\n+([\s\S]*))?$/);
  if (headingMatch) {
    const rawTitle = headingMatch[1].replace(/\s+#+\s*$/, "").trim();
    const body = headingMatch[2]?.trim() || null;
    return { title: rawTitle || null, body };
  }

  // 2. Bold text on line 1: e.g. "**Title**\n\nBody"
  const boldMatch = message.match(/^\*\*([^\n]+?)\*\*[^\S\r\n]*(?:\n+([\s\S]*))?$/);
  if (boldMatch) {
    const rawTitle = boldMatch[1].trim();
    const body = boldMatch[2]?.trim() || null;
    return { title: rawTitle || null, body };
  }

  // 3. Double newline separation: if first paragraph is a short summary/heading (<= 80 chars)
  const doubleNewlineIndex = message.search(/\n\s*\n/);
  if (doubleNewlineIndex !== -1) {
    const firstParagraph = message.slice(0, doubleNewlineIndex).trim();
    const remaining = message.slice(doubleNewlineIndex).trim();
    if (firstParagraph && firstParagraph.length <= 80 && !firstParagraph.includes("\n")) {
      return {
        title: firstParagraph,
        body: remaining || null,
      };
    }
  }

  // 4. Single-line message: treat as title
  if (!message.includes("\n")) {
    return { title: message, body: null };
  }

  // 5. Multi-line without recognized heading structure: treat as body
  return { title: null, body: message };
}

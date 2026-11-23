/**
 * Collapse carriage-return output to its final state, one line per "\n".
 *
 * A shell ends every line with "\r\n" and uses a bare "\r" to redraw a progress bar. Splitting on
 * "\r" without dropping the line-ending "\r" leaves an empty last segment, so every CRLF line
 * became blank — a failed setup command rendered an expanded panel with no output.
 */
export function processCarriageReturns(text: string): string {
  if (!text.includes("\r")) return text;
  return text
    .split("\n")
    .map((line) => {
      const content = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (!content.includes("\r")) return content;
      const segments = content.split("\r");
      return segments[segments.length - 1];
    })
    .join("\n");
}

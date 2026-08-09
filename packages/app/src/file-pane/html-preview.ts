const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

const CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`;
const HTML_ASCII_WHITESPACE = new Set(["\t", "\n", "\f", "\r", " "]);
const BOM = "\uFEFF";

function stripLeadingDoctype(source: string): string {
  let offset = source.startsWith(BOM) ? BOM.length : 0;
  while (HTML_ASCII_WHITESPACE.has(source[offset] ?? "")) offset += 1;

  const doctypeStart = source.slice(offset).match(/^<!doctype(?=[\t\n\f\r >])/i);
  if (!doctypeStart) return source.slice(offset);

  let quote: '"' | "'" | null = null;
  for (let index = offset + doctypeStart[0].length; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return source.slice(index + 1);
    }
  }

  return source.slice(offset);
}

/** Supplies a standards-mode prologue before any untrusted document markup. */
export function createHtmlPreviewDocument(source: string): string {
  return `<!doctype html>${CSP_META_TAG}${stripLeadingDoctype(source)}`;
}

export function isHtmlPreviewPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

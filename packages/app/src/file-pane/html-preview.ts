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
const BOM = "\uFEFF";

/** Supplies a standards-mode prologue before any untrusted document markup. */
export function createHtmlPreviewDocument(source: string): string {
  const sourceWithoutBom = source.startsWith(BOM) ? source.slice(BOM.length) : source;
  return `<!doctype html>${CSP_META_TAG}${sourceWithoutBom}`;
}

export function isHtmlPreviewPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

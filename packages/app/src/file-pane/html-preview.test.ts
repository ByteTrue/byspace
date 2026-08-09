import { describe, expect, it } from "vitest";
import { createHtmlPreviewDocument, isHtmlPreviewPath } from "./html-preview";

const EXPECTED_PROLOGUE =
  "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'\">";

describe("createHtmlPreviewDocument", () => {
  it("supplies the exact standards-mode policy before the source", () => {
    expect(createHtmlPreviewDocument("<h1>Plan</h1>")).toBe(`${EXPECTED_PROLOGUE}<h1>Plan</h1>`);
  });

  it("drops only a leading BOM and otherwise preserves the complete source", () => {
    const source = "\t\n\f\r <!doctype html><h1>Plan</h1>";

    expect(createHtmlPreviewDocument(`\uFEFF${source}`)).toBe(`${EXPECTED_PROLOGUE}${source}`);
  });

  it.each([
    "<!DOCTYPE HTML><h1>case</h1>",
    "<!doctype html PUBLIC \"quoted>identifier\" 'single>identifier'><h1>quoted</h1>",
    "\u00A0<!-- untrusted --!><!doctype html \"'><script>location='https://example.com'</script>",
    "<!doctypehtml><h1>missing separator</h1>",
    '<!doctype html "unterminated><h1>malformed</h1>',
    "<!-- comment --><!doctype html><h1>Comment first</h1>",
    "<h1>Headless document</h1>",
  ])("places the trusted prologue before the original source for %s", (source) => {
    const output = createHtmlPreviewDocument(source);

    expect(output).toBe(`${EXPECTED_PROLOGUE}${source}`);
    expect(output.endsWith(source)).toBe(true);
  });
});

describe("isHtmlPreviewPath", () => {
  it.each(["plan.html", "PLAN.HTM", "nested/index.html"])("accepts %s", (path) => {
    expect(isHtmlPreviewPath(path)).toBe(true);
  });

  it.each(["plan.md", "plan.html.ts", "html"])("rejects %s", (path) => {
    expect(isHtmlPreviewPath(path)).toBe(false);
  });
});

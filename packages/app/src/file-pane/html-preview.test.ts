import { describe, expect, it } from "vitest";
import { createHtmlPreviewDocument, isHtmlPreviewPath } from "./html-preview";

const EXPECTED_PROLOGUE =
  "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'\">";

describe("createHtmlPreviewDocument", () => {
  it("supplies the exact standards-mode policy before the source", () => {
    expect(createHtmlPreviewDocument("<h1>Plan</h1>")).toBe(`${EXPECTED_PROLOGUE}<h1>Plan</h1>`);
  });

  it("strips a leading BOM, HTML ASCII whitespace, and source doctype", () => {
    expect(createHtmlPreviewDocument("\uFEFF\t\n\f\r <!doctype html><h1>Plan</h1>")).toBe(
      `${EXPECTED_PROLOGUE}<h1>Plan</h1>`,
    );
  });

  it.each([
    "<!DOCTYPE HTML><h1>case</h1>",
    "<!doctype html PUBLIC \"quoted>identifier\" 'single>identifier'><h1>quoted</h1>",
  ])("strips a case-insensitive, quote-aware leading doctype from %s", (source) => {
    expect(createHtmlPreviewDocument(source)).toMatch(
      new RegExp(`^${EXPECTED_PROLOGUE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<h1>`),
    );
  });

  it.each([
    "<!doctypehtml><h1>missing separator</h1>",
    '<!doctype html "unterminated><h1>malformed</h1>',
  ])("preserves a malformed leading doctype after the trusted prologue", (source) => {
    expect(createHtmlPreviewDocument(source)).toBe(`${EXPECTED_PROLOGUE}${source}`);
  });

  it("does not treat NBSP as HTML parser whitespace", () => {
    const source = "\u00A0<!doctype html><h1>Plan</h1>";

    expect(createHtmlPreviewDocument(source)).toBe(`${EXPECTED_PROLOGUE}${source}`);
  });

  it.each(["<!-- comment --><!doctype html><h1>Comment first</h1>", "<h1>Headless document</h1>"])(
    "keeps non-doctype document content intact for %s",
    (source) => {
      expect(createHtmlPreviewDocument(source)).toBe(`${EXPECTED_PROLOGUE}${source}`);
    },
  );
});

describe("isHtmlPreviewPath", () => {
  it.each(["plan.html", "PLAN.HTM", "nested/index.html"])("accepts %s", (path) => {
    expect(isHtmlPreviewPath(path)).toBe(true);
  });

  it.each(["plan.md", "plan.html.ts", "html"])("rejects %s", (path) => {
    expect(isHtmlPreviewPath(path)).toBe(false);
  });
});

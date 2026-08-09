import { afterEach, describe, expect, it } from "vitest";
import { createHtmlPreviewDocument } from "./html-preview";

async function mountPreview(source: string): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve()));
  frame.srcdoc = createHtmlPreviewDocument(source);
  document.body.append(frame);
  await loaded;
  return frame;
}

async function waitForText(element: Element, expected: string): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (element.textContent !== expected) {
    if (performance.now() >= deadline) {
      throw new Error(
        `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(element.textContent)}`,
      );
    }
    await new Promise(requestAnimationFrame);
  }
}

afterEach(() => document.body.replaceChildren());

describe("HTML preview parsing", () => {
  it("keeps the CSP in head and standards mode when source begins with NBSP", async () => {
    const frame = await mountPreview(`\u00A0<!doctype html><p id="result">waiting</p>
<script>
  window.addEventListener("securitypolicyviolation", function (event) {
    document.getElementById("result").textContent = event.effectiveDirective;
  });
  fetch("/html-preview-browser-csp-probe").catch(function () {});
</script>`);
    const previewDocument = frame.contentDocument;
    if (!previewDocument) throw new Error("Expected preview document");

    expect(previewDocument.compatMode).toBe("CSS1Compat");
    expect(
      previewDocument.querySelector('meta[http-equiv="Content-Security-Policy"]')?.parentElement
        ?.tagName,
    ).toBe("HEAD");

    const result = previewDocument.querySelector("#result");
    if (!result) throw new Error("Expected CSP probe result");
    await waitForText(result, "connect-src");
  });
});

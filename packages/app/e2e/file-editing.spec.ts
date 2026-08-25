import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";
import { expectFileTabOpen, openFileExplorer, openFileFromExplorer } from "./helpers/file-explorer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import { splitPaneRight } from "./helpers/split-pane";

const CSP_EGRESS_CHANNELS = [
  "fetch",
  "xhr",
  "websocket",
  "beacon",
  "form",
  "remote-script",
  "image",
  "srcset",
  "font",
  "media",
  "css-import",
  "css-url",
  "base",
  "frame",
  "object",
] as const;

function editor(page: Page) {
  return page.getByTestId("file-source-editor").filter({ visible: true }).locator(".cm-content");
}

function hasHorizontalOverflow(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth;
}

function fitsViewportWidth(element: HTMLElement): boolean {
  return element.scrollWidth === element.clientWidth;
}

function modifiedIndicator(page: Page) {
  return page.locator('[data-testid^="workspace-tab-modified-"]').filter({ visible: true });
}

async function replaceEditorText(page: Page, content: string): Promise<void> {
  const contentElement = editor(page);
  await contentElement.click();
  await contentElement.press("Control+A");
  await contentElement.fill(content);
}

async function openWorkspaceFile(page: Page, filename: string): Promise<void> {
  const tree = page.getByTestId("file-explorer-tree-scroll");
  if (!(await tree.isVisible())) await openFileExplorer(page);
  await openFileFromExplorer(page, filename);
  await expectFileTabOpen(page, filename);
}

function htmlPreview(page: Page) {
  return {
    host: page.getByTestId("file-html-preview"),
    document: page.frameLocator('[data-testid="file-html-preview"]'),
  };
}

async function selectFileView(page: Page, view: "Preview" | "Source"): Promise<void> {
  await page.getByTestId("file-panel-bar").getByRole("button", { name: view, exact: true }).click();
}

test.describe("workspace file editing", () => {
  test("renders a lockfile-sized read-only source with a bounded CodeMirror DOM", async ({
    page,
  }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "file-source-lockfile-",
      title: "Large source",
      initialPrompt: "Generate a title and a git branch name. Return JSON only.",
    });
    const lockfile = `${'{"packages":['}${Array.from({ length: 42_000 }, (_, index) => `{"name":"package-${index}","version":"1.0.0"}`).join(",")}]}`;
    await writeFile(path.join(session.cwd, "package-lock.json"), lockfile, "utf8");

    try {
      await openAgentRoute(page, session);
      await openWorkspaceFile(page, "package-lock.json");

      await expect(page.getByTestId("file-source-editor")).toBeVisible();
      await expect(editor(page)).toContainText('"package-0"');
      await expect.poll(() => page.locator(".cm-line").count()).toBeLessThan(200);
    } finally {
      await session.cleanup();
    }
  });

  test("keeps the app interactive around a plain 11 MB source", async ({ page }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "file-source-plain-",
      title: "Plain large source",
      initialPrompt: "Generate a title and a git branch name. Return JSON only.",
    });
    await writeFile(
      path.join(session.cwd, "plain.txt"),
      "plain source\n".repeat(1_050_000),
      "utf8",
    );

    try {
      await openAgentRoute(page, session);
      await openWorkspaceFile(page, "plain.txt");
      await expect(page.getByTestId("file-source-editor")).toBeVisible();
      await expect(editor(page)).toContainText("plain source");
      await expect.poll(() => page.locator(".cm-line").count()).toBeLessThan(200);

      await page.getByTestId(`workspace-tab-agent_${session.agentId}`).first().click();
      await expect(page.getByTestId("message-input-root")).toBeVisible();
      await page.getByTestId("workspace-tab-file_plain.txt").first().click();
      await expect(page.getByTestId("file-source-editor")).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("refuses a file above the display budget and keeps its tab recoverable", async ({
    page,
  }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "file-source-unsupported-",
      title: "Unsupported large source",
      initialPrompt: "Generate a title and a git branch name. Return JSON only.",
    });
    await writeFile(
      path.join(session.cwd, "too-large.txt"),
      Buffer.alloc(51 * 1024 * 1024),
      "utf8",
    );

    try {
      await openAgentRoute(page, session);
      await openWorkspaceFile(page, "too-large.txt");
      await expect(page.getByTestId("file-source-too-large")).toContainText(
        "This file is too large to display",
      );

      await page.getByTestId(`workspace-tab-agent_${session.agentId}`).first().click();
      await expect(page.getByTestId("message-input-root")).toBeVisible();
      await page.getByTestId("workspace-tab-file_too-large.txt").first().click();
      await expect(page.getByTestId("file-source-too-large")).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });
  test("wraps Markdown while source code remains horizontally scrollable", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-wrap-" });
    const longLine = "word ".repeat(300);
    await writeFile(path.join(workspace.repoPath, "notes.md"), `${longLine}\n`, "utf8");
    await writeFile(
      path.join(workspace.repoPath, "source.ts"),
      `const value = "${longLine}";\n`,
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "notes.md");
    await page.getByTestId("file-mode-source").click();

    const markdownScroller = page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-scroller");
    await expect.poll(() => markdownScroller.evaluate(fitsViewportWidth)).toBe(true);

    await openWorkspaceFile(page, "source.ts");
    const sourceScroller = page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-scroller");
    await expect.poll(() => sourceScroller.evaluate(hasHorizontalOverflow)).toBe(true);
  });

  test("clicking the editor focuses its pane beside an agent", async ({ page }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "file-editing-pane-focus-",
      title: "Editor pane focus",
    });

    try {
      await writeFile(path.join(session.cwd, "target.ts"), "export const target = 42;\n", "utf8");
      await page.setViewportSize({ width: 1280, height: 900 });
      await openAgentRoute(page, session);

      await splitPaneRight(page);
      await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(2);
      await openWorkspaceFile(page, "target.ts");

      await page
        .getByTestId(`workspace-tab-agent_${session.agentId}`)
        .filter({ visible: true })
        .click();
      await editor(page).click();
      await page.keyboard.press("Alt+Shift+W");

      await expect(page.getByTestId("workspace-tab-file_target.ts")).not.toBeVisible();
      await expect(
        page.getByTestId(`workspace-tab-agent_${session.agentId}`).filter({ visible: true }),
      ).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("autosaves, saves immediately, and resolves external conflicts", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-source-" });
    const sourcePath = path.join(workspace.repoPath, "source.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await workspace.navigateTo();
    await openWorkspaceFile(page, "source.ts");

    await replaceEditorText(page, "const autosaved = 2;\n");
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const autosaved = 2;\n");

    await replaceEditorText(page, "const immediate = 3;\n");
    await editor(page).press("Control+s");
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const immediate = 3;\n");

    await writeFile(sourcePath, "const external = 4;\n", "utf8");
    await expect(editor(page)).toContainText("const external = 4;");

    await replaceEditorText(page, "const localWins = 5;\n");
    await writeFile(sourcePath, "const diskLoses = 6;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    await page.getByRole("button", { name: "Overwrite", exact: true }).click();
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const localWins = 5;\n");

    await replaceEditorText(page, "const discarded = 7;\n");
    await writeFile(sourcePath, "const diskWins = 8;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(editor(page)).toContainText("const diskWins = 8;");
  });

  test("enables Vim keybindings from Preferences", async ({ page, withWorkspace }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-vim-" });
    const sourcePath = path.join(workspace.repoPath, "vim.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await workspace.navigateTo();

    await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem("@byspace:app-settings") ?? "{}");
      localStorage.setItem(
        "@byspace:app-settings",
        JSON.stringify({ ...current, vimKeybindings: true }),
      );
    });
    await page.reload();
    await openWorkspaceFile(page, "vim.ts");
    await editor(page).click();
    await expect(page.getByText("NORMAL", { exact: true })).toBeVisible();
    await editor(page).press("i");
    await expect(page.getByText("INSERT", { exact: true })).toBeVisible();
    await editor(page).pressSequentially("X");
    await editor(page).press("Escape");
    await expect(page.getByText("NORMAL", { exact: true })).toBeVisible();
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const initial = 1;\nX");
  });

  test("preserves BOM and CRLF while saving", async ({ page, withWorkspace }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-encoding-" });
    const sourcePath = path.join(workspace.repoPath, "windows.ts");
    await writeFile(sourcePath, Buffer.from("\uFEFFconst initial = true;\r\n", "utf8"));
    await workspace.navigateTo();
    await openWorkspaceFile(page, "windows.ts");

    await replaceEditorText(page, "const saved = true;\nconst normalized = true;\n");
    await editor(page).press("Control+s");

    const expected = Buffer.from(
      "\uFEFFconst saved = true;\r\nconst normalized = true;\r\n",
      "utf8",
    ).toString("hex");
    await expect.poll(async () => (await readFile(sourcePath)).toString("hex")).toBe(expected);
  });

  test("preserves a dirty buffer across file deletion and guards pane close", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-draft-" });
    const sourcePath = path.join(workspace.repoPath, "draft.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await workspace.navigateTo();
    await openWorkspaceFile(page, "draft.ts");

    await replaceEditorText(page, "const local = 2;\n");
    await writeFile(sourcePath, "const external = 3;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    await rm(sourcePath);
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    await expect(editor(page)).toContainText("const local = 2;");
    await expect(modifiedIndicator(page)).toBeVisible();

    let closePrompt = "";
    page.once("dialog", async (dialog) => {
      closePrompt = dialog.message();
      await dialog.dismiss();
    });
    const fileTab = page.locator('[data-testid^="workspace-tab-file_"]').first();
    await fileTab.hover();
    const closeBtn = page.locator('[data-testid^="workspace-file-close-"]').first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await expect.poll(() => closePrompt.toLowerCase()).toContain("unsaved");
    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await expect(editor(page)).toContainText("const local = 2;");
  });
  test("previews and refreshes HTML while preserving source access", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-html-preview-" });
    const htmlPath = path.join(workspace.repoPath, "plan.html");
    await writeFile(
      htmlPath,
      "<!doctype html><html><body><h1>Visual plan</h1></body></html>",
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "plan.html");

    const preview = htmlPreview(page);
    await expect(preview.host).toBeVisible();
    await expect(preview.host).toHaveAttribute("sandbox", "allow-scripts");
    await expect(preview.host).not.toHaveAttribute("sandbox", /allow-same-origin/);
    await expect(preview.document.getByRole("heading", { name: "Visual plan" })).toBeVisible();

    await writeFile(
      htmlPath,
      "<!doctype html><html><body><h1>Updated plan</h1></body></html>",
      "utf8",
    );
    await expect(preview.document.getByRole("heading", { name: "Updated plan" })).toBeVisible();

    await selectFileView(page, "Source");
    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await expect(preview.host).toHaveCount(0);
    await selectFileView(page, "Preview");
    await expect(preview.host).toBeVisible();
  });

  test("renders a large HTML file after the file load completes", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-html-large-" });
    await writeFile(
      path.join(workspace.repoPath, "large.html"),
      `<!doctype html><h1>Large preview ready</h1><!--${"x".repeat(1024 * 1024)}-->`,
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "large.html");

    const preview = htmlPreview(page);
    await expect(
      preview.document.getByRole("heading", { name: "Large preview ready" }),
    ).toBeVisible();
    await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  });

  test("runs allowed HTML while independently blocking every egress channel", async ({
    page,
    withWorkspace,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "file-editing-html-isolation-" });
    const origin = new URL(baseURL ?? "http://localhost").origin;
    const httpProbeRoot = `${origin}/__html-preview-probe__`;
    const websocketProbe = `${origin.replace(/^http/, "ws")}/__html-preview-probe__/websocket`;
    const egressProbes = Object.fromEntries(
      CSP_EGRESS_CHANNELS.map((channel) => [
        channel,
        channel === "websocket" ? websocketProbe : `${httpProbeRoot}/${channel}`,
      ]),
    ) as Record<(typeof CSP_EGRESS_CHANNELS)[number], string>;
    const probes = {
      ...egressProbes,
      popup: `${httpProbeRoot}/popup`,
      top: `${httpProbeRoot}/top`,
    };
    const escapedChannels = new Set<string>();

    await page.route(`${httpProbeRoot}/**`, async (route) => {
      escapedChannels.add(route.request().url());
      await route.fulfill({ status: 204, body: "" });
    });
    page.on("websocket", (webSocket) => {
      if (webSocket.url() === websocketProbe) escapedChannels.add(websocketProbe);
    });

    const violationResults = CSP_EGRESS_CHANNELS.map(
      (channel) => `<p data-violation="${channel}">pending</p>`,
    ).join("\n");
    await writeFile(
      path.join(workspace.repoPath, "probe.htm"),
      `<!doctype html><html><head>
<style>#inline-style { color: rgb(1, 2, 3); }</style>
</head><body>
<h1 id="inline-script">Inline script did not run</h1>
<p id="inline-style">Inline style ran</p>
<p id="eval-result">Eval did not run</p>
<p id="blob-script-result">Blob script did not run</p>
<p id="parent-result">Parent DOM reachable</p>
<p id="storage-result">Storage reachable</p>
<p id="top-result">Top navigation allowed</p>
<p id="popup-result">Popup pending</p>
<button id="popup-probe">Probe popup</button>
<div id="css-url-target"></div>
${violationResults}
<script>
  var probes = ${JSON.stringify(probes)};

  document.getElementById("inline-script").textContent = "Inline script ran";
  document.getElementById("eval-result").textContent = eval("'Eval ran'");
  var blobScript = document.createElement("script");
  blobScript.src = URL.createObjectURL(new Blob([
    'document.getElementById("blob-script-result").textContent = "Blob script ran";'
  ], { type: "text/javascript" }));
  document.head.appendChild(blobScript);
  function recordViolation(channel, effectiveDirective, blockedURI, attempt) {
    return new Promise(function (resolve) {
      function onViolation(event) {
        if (
          event.effectiveDirective !== effectiveDirective ||
          event.blockedURI !== blockedURI
        ) return;
        window.removeEventListener("securitypolicyviolation", onViolation);
        document.querySelector('[data-violation="' + channel + '"]').textContent = JSON.stringify({
          effectiveDirective: event.effectiveDirective,
          blockedURI: event.blockedURI
        });
        resolve();
      }
      window.addEventListener("securitypolicyviolation", onViolation);
      attempt();
    });
  }

  async function runBlockedProbes() {
    await recordViolation("fetch", "connect-src", probes.fetch, function () {
      fetch(probes.fetch).catch(function () {});
    });
    await recordViolation("xhr", "connect-src", probes.xhr, function () {
      var xhr = new XMLHttpRequest();
      xhr.onerror = function () {};
      xhr.open("POST", probes.xhr);
      xhr.send("repo-content");
    });
    await recordViolation("websocket", "connect-src", probes.websocket, function () {
      var socket = new WebSocket(probes.websocket);
      socket.onerror = function () {};
    });
    await recordViolation("beacon", "connect-src", probes.beacon, function () {
      navigator.sendBeacon(probes.beacon, "repo-content");
    });
    await recordViolation("remote-script", "script-src-elem", probes["remote-script"], function () {
      var script = document.createElement("script");
      script.src = probes["remote-script"];
      document.head.appendChild(script);
    });
    await recordViolation("image", "img-src", probes.image, function () {
      var image = document.createElement("img");
      image.onerror = function () {};
      image.src = probes.image;
      document.body.appendChild(image);
    });
    await recordViolation("srcset", "img-src", probes.srcset, function () {
      var srcset = document.createElement("img");
      srcset.onerror = function () {};
      srcset.srcset = probes.srcset + " 1x";
      document.body.appendChild(srcset);
    });
    await recordViolation("font", "font-src", probes.font, function () {
      new FontFace("ProbeFont", 'url("' + probes.font + '")').load().catch(function () {});
    });
    await recordViolation("media", "media-src", probes.media, function () {
      var media = document.createElement("video");
      media.onerror = function () {};
      media.src = probes.media;
      document.body.appendChild(media);
      media.load();
    });
    await recordViolation("css-import", "style-src-elem", probes["css-import"], function () {
      var importStyle = document.createElement("style");
      importStyle.textContent = '@import url("' + probes["css-import"] + '");';
      document.head.appendChild(importStyle);
    });
    await recordViolation("css-url", "img-src", probes["css-url"], function () {
      var urlStyle = document.createElement("style");
      urlStyle.textContent = '#css-url-target { background-image: url("' + probes["css-url"] + '"); }';
      document.head.appendChild(urlStyle);
    });
    await recordViolation("base", "base-uri", probes.base, function () {
      var base = document.createElement("base");
      base.href = probes.base;
      document.head.appendChild(base);
    });
    await recordViolation("frame", "frame-src", new URL(probes.frame).origin, function () {
      var frame = document.createElement("iframe");
      frame.src = probes.frame;
      document.body.appendChild(frame);
    });
    await recordViolation("object", "object-src", new URL(probes.object).origin, function () {
      var object = document.createElement("object");
      object.data = probes.object;
      document.body.appendChild(object);
    });
  }

  function runFormProbe() {
    return recordViolation("form", "form-action", probes.form, function () {
      var form = document.createElement("form");
      form.action = probes.form;
      form.method = "post";
      document.body.appendChild(form);
      form.requestSubmit();
    });
  }

  if (window.name === "form-action-probe") runFormProbe();
  else runBlockedProbes();

  try { parent.document.body; }
  catch (error) { document.getElementById("parent-result").textContent = "Parent DOM blocked"; }
  try { localStorage.length; }
  catch (error) { document.getElementById("storage-result").textContent = "Storage blocked"; }
  try { top.location.href = probes.top; }
  catch (error) { document.getElementById("top-result").textContent = "Top navigation blocked"; }
  document.getElementById("popup-probe").addEventListener("click", function () {
    document.getElementById("popup-result").textContent = window.open(probes.popup)
      ? "Popup allowed"
      : "Popup blocked";
  });
</script></body></html>`,
      "utf8",
    );
    await workspace.navigateTo();
    const topLevelUrl = page.url();
    await openWorkspaceFile(page, "probe.htm");

    const preview = htmlPreview(page);
    await expect(preview.host).toHaveAttribute("sandbox", "allow-scripts");
    await expect(preview.host).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(
      preview.document.getByRole("heading", { name: "Inline script ran" }),
    ).toBeVisible();
    await expect(preview.document.locator("#inline-style")).toHaveCSS("color", "rgb(1, 2, 3)");
    await expect(preview.document.getByText("Eval ran", { exact: true })).toBeVisible();
    await expect(preview.document.getByText("Blob script ran", { exact: true })).toBeVisible();

    const expectedViolations: Record<
      Exclude<(typeof CSP_EGRESS_CHANNELS)[number], "form">,
      { effectiveDirective: string; blockedURI: string }
    > = {
      fetch: { effectiveDirective: "connect-src", blockedURI: probes.fetch },
      xhr: { effectiveDirective: "connect-src", blockedURI: probes.xhr },
      websocket: { effectiveDirective: "connect-src", blockedURI: probes.websocket },
      beacon: { effectiveDirective: "connect-src", blockedURI: probes.beacon },
      "remote-script": {
        effectiveDirective: "script-src-elem",
        blockedURI: probes["remote-script"],
      },
      image: { effectiveDirective: "img-src", blockedURI: probes.image },
      srcset: { effectiveDirective: "img-src", blockedURI: probes.srcset },
      font: { effectiveDirective: "font-src", blockedURI: probes.font },
      media: { effectiveDirective: "media-src", blockedURI: probes.media },
      "css-import": {
        effectiveDirective: "style-src-elem",
        blockedURI: probes["css-import"],
      },
      "css-url": { effectiveDirective: "img-src", blockedURI: probes["css-url"] },
      base: { effectiveDirective: "base-uri", blockedURI: probes.base },
      // Chromium reports only the origin for blocked nested browsing contexts.
      frame: { effectiveDirective: "frame-src", blockedURI: origin },
      object: { effectiveDirective: "object-src", blockedURI: origin },
    };
    for (const [channel, violation] of Object.entries(expectedViolations)) {
      await expect(preview.document.locator(`[data-violation="${channel}"]`)).toHaveText(
        JSON.stringify(violation),
      );
    }

    const formProbe = page.frameLocator('[data-testid="html-preview-form-probe"]');
    await preview.host.evaluate((host) => {
      const sibling = document.createElement("iframe");
      sibling.dataset.testid = "html-preview-form-probe";
      sibling.name = "form-action-probe";
      sibling.setAttribute("sandbox", "allow-scripts allow-forms");
      sibling.srcdoc = (host as HTMLIFrameElement).srcdoc;
      host.parentElement?.appendChild(sibling);
    });
    await expect(page.getByTestId("html-preview-form-probe")).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-forms",
    );
    await expect(formProbe.locator('[data-violation="form"]')).toHaveText(
      JSON.stringify({ effectiveDirective: "form-action", blockedURI: probes.form }),
    );

    await expect(preview.document.getByText("Parent DOM blocked", { exact: true })).toBeVisible();
    await expect(preview.document.getByText("Storage blocked", { exact: true })).toBeVisible();
    await expect(
      preview.document.getByText("Top navigation blocked", { exact: true }),
    ).toBeVisible();
    await preview.document.getByRole("button", { name: "Probe popup" }).click();
    await expect(preview.document.getByText("Popup blocked", { exact: true })).toBeVisible();
    expect(escapedChannels).toEqual(new Set());
    expect(page.url()).toBe(topLevelUrl);
  });

  test("documents that meta refresh may navigate only the sandboxed frame", async ({
    page,
    withWorkspace,
    baseURL,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-html-navigation-" });
    const origin = new URL(baseURL ?? "http://localhost").origin;
    const navigationUrl = `${origin}/__html-preview-navigation__/own-frame`;
    let navigationAttempts = 0;
    await page.route(navigationUrl, async (route) => {
      navigationAttempts += 1;
      await route.abort();
    });
    await writeFile(
      path.join(workspace.repoPath, "navigation.html"),
      `<!doctype html><meta http-equiv="refresh" content="0; url=${navigationUrl}"><p>Before navigation</p>`,
      "utf8",
    );
    await workspace.navigateTo();
    const topLevelUrl = page.url();
    await openWorkspaceFile(page, "navigation.html");

    await expect.poll(() => navigationAttempts).toBe(1);
    await expect(page.getByTestId("workspace-file-pane")).toBeVisible();
    expect(page.url()).toBe(topLevelUrl);
  });
});

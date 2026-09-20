import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static contract between `t("…")` call sites and the en resource tree.
 *
 * A key referenced in code but absent from the tree renders as the raw key string
 * in the UI (i18next returns the key itself). That failure mode survived in
 * production twice before this test existed: the whole `settings.host.network.*`
 * section rendered raw keys because the resources nest one level deeper
 * (`settings.host.daemon.network.*`), and `composer.errors.daemonClientDisconnected`
 * was referenced without an entry in that block.
 *
 * The scanner is intentionally simple: it walks the en.ts resource tree by
 * indentation and collects every `t("…")` literal under `packages/app/src`.
 * Plural suffixes (`_one`/`_other`) are folded to their stem because i18next
 * resolves those at runtime. Dynamic keys built with template literals cannot be
 * checked here and are the one known blind spot.
 */

interface ScanResult {
  missing: { key: string; files: string[] }[];
}

function collectResourceKeys(source: string): Set<string> {
  const lines = source.split("\n");
  const stack: { indent: number; key: string }[] = [];
  const keys = new Set<string>();
  for (const line of lines) {
    if (/^\s*\/\//.test(line)) continue;
    const open = line.match(/^(\s*)(["\w-]+)\s*:\s*\{\s*$/);
    if (open) {
      const indent = open[1].length;
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      stack.push({ indent, key: open[2] });
      continue;
    }
    const leaf = line.match(/^(\s*)(["\w-]+)\s*:\s*(.*)$/);
    if (!leaf) continue;
    const inlineBody = leaf[3].trim();
    const indent = leaf[1].length;
    if (inlineBody === "{") {
      // Multi-line object whose opener carries only the brace; treated the same as
      // the bare-opener branch above.
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      stack.push({ indent, key: leaf[2] });
      continue;
    }
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parentPath = stack.map((s) => s.key).join(".");
    const stem = leaf[2].replace(/_(one|other|zero|two|few|many)$/, "");
    keys.add(`${parentPath}.${stem}`);
    // Inline object opener with same-line entries, e.g.
    //   errors: { update: "…", load: "…" },
    for (const m of inlineBody.matchAll(/([\w-]+)\s*:\s*["'`]/g)) {
      keys.add(`${parentPath}.${leaf[2]}.${m[1]}`);
    }
  }
  return keys;
}

function scanUsedKeys(appSrc: string): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const files = ["ts", "tsx"].flatMap((ext) => {
    const out: string[] = [];
    const walk = (dir: string) => {
      // Lazy require keeps vitest's module graph small; readdir with type is fine.
      const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
      for (const entry of readdirSync(dir)) {
        if (entry === "i18n" || entry === "node_modules") continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(`.${ext}`)) out.push(full);
      }
    };
    walk(appSrc);
    return out;
  });
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bt\(\s*["']([w.-]+)["']/g)) {
      const set = used.get(m[1]) ?? new Set<string>();
      set.add(path.relative(appSrc, file));
      used.set(m[1], set);
    }
  }
  return used;
}

describe("i18n key contract between code and resources", () => {
  const appRoot = path.resolve(__dirname, "..", "..");
  const enPath = path.join(appRoot, "src", "i18n", "resources", "en.ts");
  const resourceKeys = collectResourceKeys(readFileSync(enPath, "utf8"));
  const used = scanUsedKeys(path.join(appRoot, "src"));
  const missing = [...used.entries()]
    .filter(([key]) => !resourceKeys.has(key))
    .map(([key, files]) => ({ key, files: [...files].sort() }));

  it("collects a non-trivial resource tree (sanity)", () => {
    expect(resourceKeys.size).toBeGreaterThan(1500);
    expect(resourceKeys.has("settings.host.daemon.network.sectionTitle")).toBe(true);
  });

  it("resolves every statically referenced t() key in the en tree", () => {
    expect(
      missing,
      `Missing i18n keys render as raw key strings in the UI. Add them to en.ts (and the other 8 locales) or fix the call site:\n${missing
        .map((m) => `  ${m.key}  (used in ${m.files.join(", ")})`)
        .join("\n")}`,
    ).toEqual([]);
  });
});

export type { ScanResult };

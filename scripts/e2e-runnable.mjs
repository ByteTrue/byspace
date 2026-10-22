#!/usr/bin/env node
/**
 * 列出在当前机器上**真的有判定力**的 Playwright spec，并写明其余为什么跑不了。
 *
 * 为什么需要它：对 Go daemon 跑 e2e 时，"失败" 有三种来源，混在一起就看不出产品缺陷：
 *
 *   1. spec 依赖 Node 的 mock provider —— Go 没有这个 provider，失败是必然的，且不含任何
 *      Go 实现的信息；
 *   2. spec 需要本机没装的 agent CLI（opencode / codex / claude ...）；
 *   3. 真的实现不一致。
 *
 * 用手工清单筛过两轮，两次都漏：第一版只匹配 `provider: "mock"`，漏掉按**模型名**
 * （`one-minute-stream`）和按 **helper**（`mock-agent` / `timeline-pagination`）依赖 mock 的
 * spec；第二版又漏掉 `agent-tab-image-stability`（经 timeline-pagination 间接依赖）。漏掉的
 * 结果是 26 条假失败，比不跑更糟——它们看起来和真缺陷一样。
 *
 * 用法：
 *   node scripts/e2e-runnable.mjs           列出可跑与排除清单
 *   node scripts/e2e-runnable.mjs --files   只输出可跑文件路径，一行一个（喂给 playwright）
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SPEC_DIR = path.join(REPO_ROOT, "packages", "app", "e2e", "browser");

/** 模型名由 Node 的 mock provider 提供；Go 侧没有这个 provider。 */
const MOCK_MODELS = [
  "one-minute-stream",
  "five-minute-stream",
  "ten-second-stream",
  "thirty-minute-stream",
  "legacy-five-minute-stream",
  "bursty-stream",
  "byspace-mock-load-test-",
  "mock-slow",
  "mock-task",
];

/** 间接依赖 mock 的 helper：引用它们等于引用 mock provider。 */
const MOCK_HELPERS = ["mock-agent", "timeline-pagination"];

/** 除 pi 以外、本机没装就无法跑的 agent CLI。 */
const EXTERNAL_CLIS = ["opencode", "codex", "claude", "copilot", "omp"];

/**
 * 收集 spec 直接 import 的文件路径与它们各自的正文。
 *
 * 判据落在两处**事实**上：被 import 的**文件名**（`mock-agent.ts` 这种），以及文件里**代码**中的
 * provider 字面量。两者都不依赖散文匹配 —— 注释里写 "mock" 不算，函数名叫 mock 但文件是
 * `assistant-images.ts` 时靠它的 import 追溯。
 */
function directImports(entryPath) {
  const absolute = path.resolve(entryPath);
  const text = readFileSync(absolute, "utf8");
  const found = [];
  for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    let resolved = null;
    if (specifier.startsWith(".")) {
      resolved = path.resolve(path.dirname(absolute), specifier);
    } else if (specifier.startsWith("@/")) {
      resolved = path.join(REPO_ROOT, "packages", "app", "src", specifier.slice(2));
    }
    if (!resolved) continue;
    for (const candidate of [
      `${resolved}.ts`,
      `${resolved}.tsx`,
      path.join(resolved, "index.ts"),
    ]) {
      if (existsSync(candidate)) {
        found.push({
          name: path.basename(candidate),
          path: candidate,
          text: readFileSync(candidate, "utf8"),
        });
        break;
      }
    }
  }
  return found;
}

/**
 * 去掉注释，只留代码。
 *
 * 注释里出现 "mock" 不算依赖：`archive-tab.ts` 的注释写着 "unlike the mock provider"，而它自己用的是
 * `provider: "opencode"`。按注释判会让 131 个 spec 被误排。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

function classify(file, source, imports = []) {
  source = stripComments(source);
  // 两跳：spec → helper → 该 helper 直接 import 的文件名。`assistant-images.ts` 自己不含 mock，
  // 它的 import 里有 `mock-agent`。这是文件名事实链，不是散文匹配。
  const helperNames = imports.flatMap((entry) => [
    entry.name,
    ...directImports(entry.path).map((nested) => nested.name),
  ]);
  const helperCode = imports.map((entry) => stripComments(entry.text)).join("\n");
  // `.real.` 后缀的 spec 需要真实凭据、网络或已安装的 CLI，本机不成立。
  if (file.endsWith(".real.spec.ts")) {
    return "REAL";
  }
  // 文件名含 mock 的 helper，或已知的 mock helper 被直接 import。
  if (helperNames.some((helper) => helper.includes("mock"))) {
    return "MOCK_PROVIDER";
  }
  if (MOCK_HELPERS.some((helper) => helperNames.some((name) => name.startsWith(helper)))) {
    return "MOCK_PROVIDER";
  }
  if (/provider:\s*["']mock["']/.test(source)) {
    return "MOCK_PROVIDER";
  }
  const modelHit = MOCK_MODELS.find((model) => source.includes(model));
  if (modelHit) {
    return `MOCK_PROVIDER(${modelHit})`;
  }
  const cliHit = EXTERNAL_CLIS.find((cli) =>
    new RegExp(`provider:\\s*["']${cli}["']`).test(`${source}\n${helperCode}`),
  );
  if (cliHit) {
    return `EXTERNAL_CLI(${cliHit})`;
  }
  return "RUNNABLE";
}

export { classify as classifyForTest };

// 只在被直接执行时跑主流程：被测试 import 时不应打印清单，否则 `node --test` 的输出被淹没。
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (!invokedDirectly) {
  // 导出给测试用，不执行扫描。
} else {
  const specs = readdirSync(SPEC_DIR)
    .filter((name) => name.endsWith(".spec.ts"))
    .sort();

  const groups = new Map();
  for (const name of specs) {
    const specPath = path.join(SPEC_DIR, name);
    const own = readFileSync(specPath, "utf8");
    const verdict = classify(name, own, directImports(specPath));
    const key = verdict.split("(")[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ name, verdict });
  }

  const runnable = (groups.get("RUNNABLE") ?? []).map((entry) => entry.name);

  if (process.argv.includes("--files")) {
    for (const name of runnable) console.log(path.join(SPEC_DIR, name));
    process.exit(0);
  }

  console.log(`可跑 ${runnable.length} / ${specs.length} 个 spec\n`);
  for (const [kind, entries] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    if (kind === "RUNNABLE") continue;
    const reasons = new Map();
    for (const entry of entries) reasons.set(entry.verdict, (reasons.get(entry.verdict) ?? 0) + 1);
    const breakdown = [...reasons]
      .map(([reason, count]) => `${count}× ${reason}`)
      .sort()
      .join(", ");
    console.log(`${kind}: ${entries.length}（${breakdown}）`);
    for (const entry of entries) console.log(`  ${entry.name}  [${entry.verdict}]`);
  }
}

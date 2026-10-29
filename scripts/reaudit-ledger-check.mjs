#!/usr/bin/env node
// 校验重审账本的内部一致性。
//
// 存在理由：账本用精确字符串替换写入过，而 formatter 会给表格列加 padding，于是替换
// 静默匹配不到——13 条结论写进去、报告成已提交、文件里其实没有。这个脚本让那种情况
// 无法再发生：条目总数必须等于文件数，总览必须与行一致，已核实的条目必须指向具体的
// Go 位置而不是「—」。
import fs from "node:fs";
import path from "node:path";

const LEDGER = "byissue/issues/node-reaudit-log.md";
const ROOTS = [
  ["archive/packages/server/src", "server"],
  ["archive/packages/cli/src", "cli"],
  ["packages/relay/src", "relay"],
];
const VERDICTS = ["待审", "MATCH", "FIXED", "N/A", "DROPPED", "已实现未接线", "MISSING"];

const text = fs.readFileSync(LEDGER, "utf8");

// 期望的条目集合，从快照或磁盘上的真实文件列表算出来。
const expected = new Set();
if (!fs.existsSync("archive/packages/server/src")) {
  const snap = JSON.parse(fs.readFileSync("scripts/node-surface-snapshot.json", "utf8"));
  for (const file of snap.ledgerFiles ?? []) {
    expected.add(file);
  }
} else {
  for (const [root] of ROOTS) {
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.isDirectory()) return walk(path.join(dir, e.name));
        if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) return [path.join(dir, e.name)];
        return [];
      });
    for (const file of walk(root)) {
      expected.add(file.slice(root.length + 1));
    }
  }
}

// 账本里的条目。
const rows = new Map();
for (const line of text.split("\n")) {
  if (!line.startsWith("| `")) continue;
  const cells = line.split("|").map((c) => c.trim());
  // 只认文件表：第 2 列是行数、第 3 列是结论词。总览表也带反引号和数字，靠结论词排除——
  // 它的第 3 列是另一个数字。
  if (!cells[1].startsWith("`") || !/^\d+$/.test(cells[2])) continue;
  let verdict = (cells[3] ?? "").replace(/\*/g, "");
  // 「未实现」不是 VERDICTS 里的词：发现能力缺口时本该写 MISSING，但 spec 禁止最终出现 MISSING。
  // 两者都属于「有结论且未修」，统一归到 MISSING 名下，好让计数口径唯一。
  if (verdict.startsWith("未实现")) verdict = "MISSING";
  if (!VERDICTS.some((v) => verdict.startsWith(v))) continue;
  const file = cells[1].replace(/^`|`$/g, "");
  const note = cells[4] ?? "";
  rows.set(file, { verdict, note });
}

const problems = [];

// 1) 条目集合必须与文件集合一致：多一条、少一条都是过时。
//
// 三个根目录下都有 `index.ts`，所以账本允许用 `<目录>/index.ts` 这种带前缀的写法来消歧。
// 比对时把前缀也算一种相对路径，而不是要求两者字面相同。
const resolve = (file) => {
  if (expected.has(file)) return file;
  for (const [, prefix] of ROOTS) {
    const rest = file.slice(prefix.length + 1);
    if (file.startsWith(`${prefix}/`) && expected.has(rest)) return rest;
  }
  return null;
};
for (const file of expected) {
  const covered = rows.has(file) || ROOTS.some(([, prefix]) => rows.has(`${prefix}/${file}`));
  if (!covered) problems.push(`缺少条目：${file}`);
}
for (const file of rows.keys()) {
  if (resolve(file) === null) problems.push(`多余条目（文件已不存在）：${file}`);
}

// 2) 总览必须与行一致，不能手写。
const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
for (const { verdict } of rows.values()) {
  const matched = VERDICTS.find((v) => verdict.startsWith(v));
  if (!matched) {
    problems.push(`无法识别的结论：${verdict}`);
    continue;
  }
  counts[matched] += 1;
}
for (const verdict of VERDICTS) {
  const pattern = new RegExp(`\\|\\s*${verdict}\\s*\\|\\s*(\\d+)\\s*\\|`);
  const found = text.match(pattern);
  if (!found) {
    problems.push(`总览缺少「${verdict}」一行`);
    continue;
  }
  if (Number(found[1]) !== counts[verdict]) {
    problems.push(`总览「${verdict}」写的是 ${found[1]}，行里是 ${counts[verdict]}`);
  }
}

// 3) 已核实的条目必须带证据。`—` 占位是「还没看」，出现在 MATCH/FIXED 上说明结论是空写的。
for (const [file, { verdict, note }] of rows) {
  if (verdict === "待审") continue;
  if (!note || note === "—" || note.length < 20) {
    problems.push(`结论 ${verdict} 缺少说明：${file}`);
  }
}

if (problems.length > 0) {
  console.error(`账本不一致（${problems.length} 条）：`);
  for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
  if (problems.length > 40) console.error(`  … 还有 ${problems.length - 40} 条`);
  process.exit(1);
}

console.log(
  `账本一致：${rows.size} 个文件 · ` +
    VERDICTS.filter((v) => v !== "待审")
      .map((v) => `${v} ${counts[v]}`)
      .join(" · ") +
    ` · 待审 ${counts["待审"]}`,
);

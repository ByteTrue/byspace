# 003：「工具回显污染」的三个真凶与排查顺序

来源：2026-09-28 两个 pi 会话（charming-wombat 修复会话 `01a0e8f2`、nice-hyena 4K 调查会话 `01a0e8ec`）都多次报告「工具输出和磁盘对不上」「回显污染」，事后用 pi 会话 JSONL 逐项核验，结论与直觉相反。两个会话合计 483 次工具调用，真正异常只有 1 次。

## 排查顺序（按命中率排序）

1. **先查自己的 `rg` 参数**。`rg -rn "pattern"` 在所有平台（Linux/macOS/Windows 同一个二进制）被解析为 `-r n` = `--replace n`：输出里所有匹配被替换成字面 `n`。症状极具迷惑性——`export function getSendingClientMessageIds(` 变成 `export function n(`，看起来像「回显被压缩/minify 了」。这不是递归！rg 搜目录默认就递归，想带行号用 `-n`，别把 `-r` 混进短选项串。两个会话共 4 次实锤全是它。
2. **再对比工具调用的原始参数**。pi 会话 JSONL（`~/.pi/agent/sessions/<cwd-dir>/<timestamp>_<id>.jsonl`）记录了每次 toolCall 的 `arguments` 和 toolResult 全文，是仲裁「我当时看到的是不是真的」的唯一可信证据。用 node 解析（机器上没有 python）。重点核对：声称异常的那条输出，它前面的 toolCall 命令原文到底是什么。
3. **警惕「记忆失误」型误报**。两个会话里最严重的两次「污染」（「返回的内容不是我写的代码」「出现了我没创建过的文件」）都是模型忘了自己 30 秒前的动作：一次把 write/edit 成功确认（135 字节纯文本，不含代码）当成「不是我写的代码」；一次忘了自己在 vitest 命令里追加了第二个测试文件。**归档日志不会忘，模型会。** 觉得输出不对时，先翻 JSONL 再下结论。
4. **read 输出的 `[N more lines in file]` 截断提示**是按 limit 截断，不是「被压缩」。两次不同 limit 的 read 输出做全等比较必然不等，先检查 limit 是否相同。

## 唯一的真实异常：本地网关超时注入（1/483）

症状：bash toolCall 的 `command` 参数里被拼入思考片段（`litera...`、`Let me run the right commands.`）、路径 typo（`nne-hyena`）、以及 `<system_warning>[[R] Response limit reached (45s timeout for tool calls), aborting tool call. ...]` 网关文本，之后才是本想执行的命令。

- 注入源不在 pi（pi 0.87.1 源码 grep 不到这三个字符串）、不在 run-history.jsonl，定位在 `bytetrueapi` 本地网关（`http://localhost:23000/v1`）或其上游：45s 工具调用超时中止→续传时，调度提示词串进了流式工具参数。
- 这是生成层一次性事件，不是回显层、不是 pi 存储。遇到时丢弃该次调用重发即可，不要据此判定「会话被污染」。
- 复核方法：解析 JSONL 里可疑 toolCall 的 `arguments.command`，看是否混入 `<system_warning>` / `[[R]]` / 思考文本。

## 通用教训

- 「环境不可信」的结论成本很高：一旦采信，后续正常输出（git diff、edit 确认）都会被误判，白耗轮次。正确的顺序是「先怀疑自己的命令 → 再查 JSONL 证据 → 最后才怀疑环境」。
- 交叉验证用 typecheck/test/git diff 这类不经过「感知」的信号是对的；但对比两个 read 输出前先确认 limit 相同。
- 模型在 Windows shell 下确实更易犯错（路径分隔符、嵌套引号转义、混用 cmd/bash 习惯），但 `rg -rn` 不在此列——那是纯参数知识错误，跨平台同样会犯。

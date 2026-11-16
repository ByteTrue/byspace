# 009：在模板字面量里生成 JS 源码，转义要再躲一层

> **读者：** 用模板字面量拼出可执行脚本/配置文件并写盘的人（provider 生成扩展、e2e 生成测试夹具）。
> **自检：** 一句话结论 · 何时用 · 坑 · 相关位置。

---

**结论：** 模板字面量里写 `"\\n"` 才会在生成的文件里得到 `\n` 两个字符；写成 `"\n"` 生成的是真实换行，脚本语法错误。`String.fromCharCode(10)` 之类的写法看着丑，但它是当年为了躲这层转义才写的——把它「顺手简化」成 `"\n"` 会静默弄坏生成物。

**何时用：** 改任何内联在模板字面量里的目标语言源码；尤其是看见 `String.fromCharCode` 想去美化时。

## 坑

- **症状离根因很远。** 生成脚本语法错误 → Pi 起不来 → 真机 e2e 报 `Test timed out in 240000ms`，看起来像 provider 挂死，实际是写盘时少了一层转义。
- **模板字面量 + 目标语言两层转义要一次想清：** 目标文件里想要 `\n`，源码里就得是 `"\\n"`；`\`、`"`、${} 同理。
- **验证成本极低，别跳。** 生成物能用 `node --check <file>` 就先跑一次，比 4 分钟超时便宜。

## 相关位置

- 踩点：`packages/server/src/server/daemon-e2e/pi.real.e2e.test.ts` 的 `PI_MCP_PROBE_SERVER_SOURCE`（探针 server 的 `log()` 用 `appendFileSync(logPath, line + "\\n")`；改坏那次 e2e 跑满 240s 超时）。
- 生成扩展的同款场景：`packages/server/src/server/agent/providers/pi/agent.ts` 的 `createPiBySpaceExtensionFile`。

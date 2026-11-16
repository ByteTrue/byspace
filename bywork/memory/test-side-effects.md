# 测试与开发副作用：真实资源泄漏

## 结论

- e2e 的 project 守卫必须带 workspace：testid 携带 viewKey，跨文件复用同名 project 会泄漏到别的 spec。
- `createTempGithubRepo` 真的在 GitHub 创建 byspacetmp-\* 私有仓库；cleanup 在 try/catch 里静默失败；曾泄漏约 20 个触发 `You have created too many repositories, too quickly`（2026-10-13 清理 20 个）。跑相关 e2e 后检查 GitHub 残留。
- worktree daemon 会残留：曾一次清理 71 个。清理前先数、按 home 归因，避免杀错（生产 6777 绝不能碰）。
- tunnel 立即绑定 127.0.0.1:<port>，即使对端不可达；macOS 上 specific 绑定胜过 wildcard → 曾劫持 magpie gateway 3425 与 mmr 3426。tunnel 持久化在 `$BYSPACE_HOME/tunnels.json` 且开机重绑，重启 daemon 没用，先删记录。查占用：`lsof -nP -iTCP:<port> -sTCP:LISTEN`。

## 依据

- 类型：可重跑证明（泄漏均实际发生并清理过）+ 外部观察（macOS 绑定优先级、GitHub 限流文本）。
- 被否决的相关方案：信任 try/catch cleanup（静默失败）；重启 daemon 释放 tunnel 端口（开机重绑）。
- 证据或复核方式：笔记 `bywork/archive/v1/notes/011-playwright-spec-cross-file-project-leak.md`、`012-github-fixture-repo-leak.md`、`2026-10-15-byspace-stray-daemon-inventory-and-cleanup.md`、`2026-11-02-test-tunnels-bind-real-ports.md`；fixture `web/e2e/support/fixtures.ts`（projectOwnership、createTempGithubRepo 仍在用）。
- 适用条件：e2e、tunnel 测试、worktree 开发。AGENTS.md 禁止为复现问题起 daemon，用 in-process harness（docs/ad-hoc-daemon-testing.md）。

## 重访条件

- fixture 改为 mock GitHub（真实创建消失）。
- tunnel 绑定策略改为延迟绑定或可配置端口。

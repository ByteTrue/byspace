---
type: ff
---

# dev daemon 在无 make 的机器上起不来；改生产 home 的 relay endpoint 会掐断会话

## 做了什么

起因是个人运维：把自己 VPS 上的 relay 换掉官方 Cloudflare Worker（慢 + Durable Object 回收长连接）。落地过程与实测数据留在私有运维仓库 `self-hosted:docs/incidents/2026-11-11-relay-direct-on-8443.md`，**那条线不是本仓库的需求**。本条只收本仓库里被那次操作暴露出来的东西。

三件事：

1. `npm run dev:daemon` 在没装 `make` 的机器（本机 Windows）上直接 `spawnSync make ENOENT` 退出，dev daemon 永远起不来。结果是「想验证 daemon 侧配置」就只剩生产 daemon 这一条路 —— 那正是第 3 条事故的入口。
2. 生产 home（`~/.byspace` / 6777）的 relay endpoint 不是本地服务配置，而是远端会话的传输路径。对它 `onboard --relay-endpoint` + `daemon reload` 之后，远端客户端立刻失去 host，工作当场中断（包括发起这次修改的这个 agent 自己的会话）。这不是推测，是本次实际发生的事故。
3. `--relay-endpoint` 的 scheme 有坑：只写 `host:8443` 会走 `useTLS := port == 443` 判成明文，然后静默连一个不存在的明文端口。

## 改了哪些

- `scripts/dev-daemon.mjs`：`make` 抛 `ENOENT` 时回退到等价的 `go build -tags nogui -trimpath -ldflags …`；`build-full` 分支先跑 `npm run build:daemon-web-ui`；缺失二进制时的提示补上不依赖 `make` 的命令。
- `docs/development.md`：新增「Never rewrite the production home to test something」，写清事故形态（配置文件可回滚但运行中的 daemon 会继续用新 endpoint）、`wss://` 必须显式、dev home 会记住设过的 endpoint。
- `AGENTS.md`：critical rules 加一条硬规则，放在「NEVER restart the BySpace daemon on port 6777」旁边。

## 怎么验证的

- 实测：修前 `npm run dev:daemon` 退出码 1，日志 `spawnSync make ENOENT`；修后同一条命令起出 `127.0.0.1:6778`，`daemon status` 报 `version=0.24.8`（go build 回退带上了 ldflags）。
- 实测：事故复现与恢复。切到自带 relay 后 `ss` 在 VPS 上看到 ESTABLISHED，同时远端客户端已经连不上；`onboard --relay` + `daemon reload` 后 `daemon status` 回到 `wss://app.byspace.cc.cd:443`，PID 未变。
- 实测：`npm run typecheck`（5 个 workspace）、`npm run lint -- scripts/dev-daemon.mjs`、`npm run format:check` 通过。
- 无法判定：手机端与其他设备的重新配对未验证；dev home 里现在留着指向 VPS relay 的 endpoint，下次 `npm run dev:daemon` 会去连它。

## 对 byissue/ 的影响

- 无需求变更。`docs/development.md` 的既有结论（`BYSPACE_LISTEN` 覆盖 `BYSPACE_HOME`，`npm run cli` 默认打 dev daemon）保持不变，这次只是在它旁边补了「改生产配置」这一类新事故。
- 已知未补：paseo 的 `scripts/dev.ps1` 在非 worktree 场景用一次性临时 home（`%TEMP%/paseo-dev-<rand>`，退出即删），本仓库的持久 `.dev/byspace-home` 是有意保留的（e2e 与 Playwright 依赖它），所以没有搬。

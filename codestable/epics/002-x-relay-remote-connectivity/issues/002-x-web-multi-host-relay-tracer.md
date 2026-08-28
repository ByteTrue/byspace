---
kind: issue
title: "打通 Web/PWA direct + Relay 多主机配对与恢复"
type: feature
status: closed
created: 2026-08-27
---

# 打通 Web/PWA direct + Relay 多主机配对与恢复

## 做成以后是什么样

用户从一台 direct Go daemon 托管的 copied Web/PWA 导入另一台 Go daemon 的 authenticated v3 pairing URL 后，Web 同时保留两台真实 host：direct host 继续在线，remote host 经 Relay E2EE 连接。用户可以在同一浏览器中看到并切换两台 host 的 workspace/Agent，在 remote host 创建并续写 Agent；reload、Relay 短断线和 remote daemon restart 后，pairing identity、host 归属、canonical Timeline 与 direct host 都保持正确。

这是 Epic 002 的浏览器级多主机闭环，不是再写一个 client-only Relay 测试，也不是借 seed/fake WebSocket 跳过真实 HostRuntime、router、IndexedDB/AsyncStorage 和 UI。

## 当前基线

- [`001-x-relay-v2-agent-tracer.md`](001-x-relay-v2-agent-tracer.md) 已证明 copied `DaemonClient` 经忠实 Relay v2 harness 访问真实 Go daemon，并覆盖 authenticated E2EE、restart、Timeline 和负向安全边界。
- copied Web 已有 `HostRuntimeStore`、v3 offer import、持久 host registry、per-host controllers、directory/timeline replicas、host-aware routes 和 sidebar/settings UI。
- 现有 Playwright Go-daemon tracer 只连接由当前 daemon 同源托管的单一 direct host；它尚未证明浏览器真实 runtime 同时管理 direct 与 remote host。
- 生产 Cloudflare deployment 仍不属于本 Issue；测试使用与 Worker v2 query/control contract 一致的 deterministic local Relay，并继续使用 `fixtures/pi/fake-rpc.mjs`。

## 范围

### 1. Browser E2E topology

- 在一个 Playwright test worker 内启动 deterministic local Relay v2、direct Go daemon A、remote Go daemon B；两个 daemon 使用不同 `BYSPACE_HOME`、listen、launch directory 和 stable `serverId`，共用离线 fake Pi executable，但状态和 invocation evidence 隔离。
- 浏览器只从 daemon A 的同源 Web 入口启动；A 作为 direct host 自动 bootstrap。B 配置 outbound Relay，并由 active daemon pairing-offer RPC 生成 v3 offer。
- 不在浏览器 page 中注入 fake DaemonClient、伪造 host registry 或直接调用内部 store mutation；pairing 必须经过用户可到达的 offer URL/fragment import path。

### 2. Authenticated offer import and host ownership

- 将 B 的 `#offer=` fragment 带入当前 Web origin，验证 HostRuntime 严格解析 canonical v3 fields、保存 `clientAuthTokenB64` 并建立 Relay connection。
- 验证 host registry 同时包含 A/B 且 `serverId` 不被 route、workspace ID 或 agent ID 混淆；两台 daemon 的错误、目录和 Timeline 只投影到各自 host。
- pairing secret 不得进入 query string、HTTP request、console/error、截图文字或 Relay plaintext frames；测试只允许在受控 harness 侧为认证断言临时持有 offer。

### 3. Real multi-host user path

- 通过真实 UI/host-aware route 在 A 与 B 间切换，确认每台 host 显示自己的 deterministic project/workspace。
- 在 B 的 Web composer 创建 Pi Agent、发送 prompt、等待 streamed assistant response 和 idle；A 保持可访问且不出现 B 的 Agent/Timeline。
- 对可访问性稳定的用户动作使用 role/label/testID；不依赖 React internals、实现类名或任意 sleep。

### 4. Recovery and isolation

- page reload 后 registry 和 authenticated Relay connection 自动恢复，B 的 Agent 与 Timeline 从 daemon canonical state 重建。
- Relay 短暂中断后自动重连；该错误只归属 B，A 的 direct session 不被断开或显示 remote 错误。
- B clean restart 后沿用相同 Relay identity/offer 和 Agent state；Web 恢复到同一 B host/Agent，后续 prompt 使用 Pi native `--session` 续写且 Timeline 不重复。
- 测试 teardown 必须关闭两个 daemon、Relay、browser clients 和 fake Pi child；无残留 PID/socket/timer。

### 5. 最小产品修复

- 优先通过新增 Playwright topology/fixtures 固定已存在行为；只修复 tracer 实际暴露的 HostRuntime、routing、pair import、reconnect 或 UX bug。
- 保留 copied Web 的 incumbent visual system；本 Issue 不重做导航、品牌或 pairing UI。
- 若用户可见错误或恢复状态不清晰，只做与多主机故障归属直接相关的最小文案/状态修复，并补 component/unit test。

## 不在本 Issue

- `relay.byspace.cc.cd` 的真实 Cloudflare deployment、DNS/TLS、rate limiting 和 production smoke；
- CLI remote target store；
- 多浏览器/多人 capability revocation；
- QR camera 扫码、原生 deep link 或移动/桌面原生客户端；
- terminal/files/Git/Forge 等尚未进入 Go daemon 的业务域；
- 视觉 redesign、host management IA 重构或 PWA 发布流水线。

## 实现记录（2026-08-28）

- 新增 [`packages/app/e2e/go-daemon/multi-host.spec.ts`](../../../../packages/app/e2e/go-daemon/multi-host.spec.ts)：在一个真实 Chromium worker 内启动 Cloudflare Wrangler Relay、两个隔离 Go daemon 和 offline fake Pi，从 daemon A 托管的 production Web bundle 经 v3 `#offer=` 导入 B。
- tracer 通过真实 Hosts/project UI 在 A/B 间切换；验证 B 的三轮 canonical Agent Timeline、A 的独立一轮 Timeline，以及完整有序 `{seqStart,type,text}` 数组和稳定 server/Agent/pairing identity。
- Relay 停止时，Hosts picker 只把 B 投影为 connecting/offline/error；A 仍为 online 且可完成 turn。Relay 恢复后不 reload page，B 自动回到 online 并续写；B daemon restart 后同样原页恢复，fake Pi invocation 明确包含 native `--session`。
- `HostRuntimeStore` 的初始 registry load 现在是共享 single-flight：offer import 必须等待旧 registry 和 placeholder migration 持久化完成，避免异步 load/migration 覆盖刚导入的 authenticated host。deferred read + deliberately delayed migration write unit test 固定了该竞态。
- `HostStatusDot` 保持既有视觉系统不变，但补充 live accessible status label/test ID，连接状态不再只靠颜色表达，也为真实 host-scoped outage/recovery 断言提供稳定语义。
- pairing secret 断言覆盖所有 console levels、page errors、HTTP request URLs/current URL、rendered body、Relay frames、daemon/Relay process output；Wrangler state 隔离到临时目录，teardown 用 all-settled cleanup、socket down probe 与 fake-Pi PID liveness 检查防止残留。

## 验证与关闭（2026-08-28）

- `npm run typecheck`：通过。
- `npm run test`：protocol 58 files / 633 tests、client 6 / 141、app unit 571 / 4777、Relay 8 passed + 1 skipped files / 68 passed + 1 skipped tests。
- `npm run lint`：通过，0 errors；14 个既有 warning 不在本 Issue 改动范围。
- `npm run test:browser`：11 files / 103 tests 通过。
- `npm run test:e2e:go-daemon`：multi-host 与 local tracer 共 2 tests 通过。
- `npx playwright test --config playwright.go-daemon.config.ts e2e/go-daemon/multi-host.spec.ts --repeat-each=20 --workers=1`：20/20 连续通过（14.0m）。
- `cd go && go vet ./... && go test -race ./... && GOOS=windows GOARCH=amd64 go build ./...`：通过。
- `impeccable` UI anti-pattern detector：无输出；focused code review 结论为 `No issues found / Merge OK`。

关闭判断：用户态 direct + authenticated Relay 多 Host 主路径、隔离故障与原页自动恢复均已有 browser-level 证据，storage race 有确定性回归测试，secret/log/resource 边界有显式负向断言；目标和质量门均满足，因此按 standing authorization 关闭。生产 `relay.byspace.cc.cd` 部署与 Go CLI remote target 仍由 Epic 002 后续切片承担，不属于本 Issue 的残缺实现。

## 风险与穿刺证据

| 风险 | 必须怎样证明 |
| --- | --- |
| 测到的仍只是 client transport，不是真实 Web | 从 daemon A 托管的 production Web bundle 启动浏览器，经 fragment import、HostRuntime 和真实 UI 操作 B |
| remote pairing 覆盖或污染 direct host | registry、route、workspace 和 Agent 断言同时包含 A/B，停止 B/Relay 时 A 仍可用 |
| reload 后 secret/host 丢失 | 不重新注入 offer，reload 后 B 自动恢复并读取 canonical Timeline |
| Relay disconnect 触发全局错误或无限 reconnect | B 显示 scoped reconnect/offline，A 保持 online；恢复 Relay 后 bounded deadline 内重连 |
| daemon restart 生成新 host | B restart 后 server ID、offer identity、host route 和 Agent ID 不变，Pi invocation 含 `--session` |
| E2E teardown 泄漏进程 | 测试最终验证 daemon/Pi PID 退出，并由 fixture 在失败路径强制 cleanup |

## 验收

- 新 Playwright Go-daemon multi-host suite 在真实 Chromium 中完成 direct A + Relay B pairing、host切换、remote create/send/live Timeline、reload、Relay reconnect、B restart/resume；
- Relay harness 忠实使用 `role=client/server&v=2`、Relay-assigned connection ID 和 `connected` / `disconnected` / `sync`，不得恢复已废弃的 invented control payload；
- 断言 Relay routed frames 不含 prompt/assistant plaintext，pairing token 不进入 app HTTP request/query 或日志；
- existing local Go-daemon tracer、client Relay E2E、103 条 browser regression 保持绿色；
- `go vet ./...`、`go test -race ./...`、Windows amd64 cross-build、workspace typecheck/tests/lint/build 通过；
- focused review 无 P0/P1/P2，实际行为、限制与验证回写 Epic/Project Spec 后按 standing authorization 关闭。

---
kind: work
status: complete
current_unit: "全部验收完成"
next_action: "无"
must_hold: "不固定本机 Node，不改全局 Node/npm/PATH；不重打 v0.26.4；不改生产 home 的 relay/tunnel/listen 配置"
proof_gap: ""
---

# 项目 npm 与 v0.26.4 验收

用户要求：「我全局就是要最新node lts的,那我用corepack来管你项目的版本总可以吧,反正不要影响到我全局」。确认采用项目局部 shim 后要求：「嗯,那就按你建议的落地吧.然后继续完成发版」。

项目固定 npm 10.9.9，不固定开发者 Node。CI 自己选择 Node 测试环境。局部 shim 只作用于入口启动的子进程。

| 行为路径 | 真实入口 | 操作 | 应观察到 | 证据 | 结果 |
|---|---|---|---|---|---|
| 项目 npm 与嵌套脚本 | node scripts/project-npm.mjs | 查询版本、运行包含 npm 的脚本及 version lifecycle | 全部 npm 10.9.9；全局版本和 PATH 不变 | node --test scripts/project-npm.test.mjs 通过；全局 npm -v 仍 12.2.2。旧的临时夹具仅 corepack npm 外层时内层返回 11.20.0，新入口内层返回 10.9.9 | 通过 |
| 安装幂等 | 同一入口 install | 比较 lockfile，连续执行 | lockfile 不变 | 两次 node scripts/project-npm.mjs run release:prepare 均 exit 0；MD5 均 29fdf786d288da17a58c9b8aef6e2549 | 通过 |
| CI 与本机同 npm | GitHub workflows | 检查各 setup-node 后的项目 npm 设置 | 使用 packageManager 声明；不更改 Node 测试环境 | PR #48 CI 与 Docker build 全绿后合并（main bf55532ba）；本地 setup-ci 写 GITHUB_PATH 已测 | 通过 |
| v0.26.4 发布 | GitHub Release、Actions、托管站点、registry | 检查发布状态与资产 | 发布物、正文、镜像、部署可用 | 五个工作流成功；Release 正文逐字匹配批准 changelog；**19 个资产全部下载并逐个校验哈希通过**（`gh release download v0.26.4` → `.dev/release-verify/`，`shasum -a 256 -c SHA256SUMS` 16 个原生资产全 OK，container.txt 对其 `.sha256` 兄弟文件 OK；`.dev/release-verify.log` 两个 exit=0）；0.26.4 与 latest 均 digest 0fd66a6b77097e41852579c794600b1f4b6305f63fea2b355de0fbb51d2adb27；部署日志有真实 pairing 成功 | 通过 |
| 升级后 tunnel 空闲稳定性 | 两台目标机升级到 0.26.4 后的真实 tunnel | 升级后空闲观察再请求转发端口 | 不再周期性断连，空闲后转发可用 | 本机运行 exe SHA256 匹配 0.26.4 发布物；127.0.0.1:34125→zijies-MacBook-Pro.local:3425 空闲观察 180s（15:36:20–15:39:20）0 断连（此前每 46–51s 一断），空闲后 HTTP 200。**2026-11-19 真实双 daemon 复验通过**：本地 relay + 两个 0.26.4 daemon + E2EE 客户端，两条转发规则同时空闲 900.0s，897 次状态轮询全 connected、0 断连 0 重连、无 lastError；空闲前后各 3 次/条 HTTP 全 200 且响应体正确；daemon 日志只在主动清理时出现 socket 关闭。证据 `.dev/tunnel-verify/VERDICT.md`、`run-2026-11-19T01-20-11-404Z-42341/report.json`、原始轮询与双侧 daemon 日志同目录，可重跑 `node .dev/tunnel-verify/run.mjs`。未覆盖托管 relay 与亚秒级抖动 | 通过 |

## 本轮补验（资产哈希）

`gh release download v0.26.4` 把 19 个资产全部拉到 `.dev/release-verify/`，逐个校验：

- `shasum -a 256 -c SHA256SUMS` → 16 个原生资产**全部 OK**（apk、7 个 CLI、4 个 macOS 包、2 个 linux、2 个 windows exe）。
- `SHA256SUMS` 不含 container 描述符（它有自己的兄弟文件）：`shasum -a 256 -c BySpace-0.26.4-container.txt.sha256` → OK，`d79e0d22020711dc6a6e04b969b902bcd1d049a7ddcb2aae6e9cc3386e1b4cac`。
- 两条命令 exit=0，原始输出在 `.dev/release-verify.log`。

## heartbeat：不是工具不可用，是入口找错了

旧记录写「heartbeat 工具不可用」——错的。MCP 侧确实没有 `create_heartbeat`，但 CLI 一直有：`byspace heartbeat <create|list|delete>`，`create` 支持 `--every/--expires-in/--cron/--prompt/--agent-id/--addr`。`byspace heartbeat list` 当前为空。

v0.26.4 已发布完成（19 个资产齐全、哈希全对），**补建一个「babysit」heartbeat 已无意义**——它的职责是盯到发布完成，而发布已经完成。docs/release.md 要求的是「tag push 后立即建」，事后补建不产生它承诺的行为。

顺带修掉 docs/release.md 两处与事实矛盾的句子：`:177` 说「in progress after npm publication」、`:186-189` 要求检查 npm dist-tags 与 Release 里的 npm tarball。**npm 包根本没发布**（`npm view bytetrue-byspace` → 404；全仓只有 `--dry-run` 的 publish 脚本，`:44` 自己也写着 "it is not published"）。改为：tag push 后即 in progress；heartbeat 检查 tag/Actions/Release 正文与资产/部署，tarball 是本地 dry-run 产物。

## tunnel 稳定性：已用两个 dev daemon 实测，没碰生产

原判断「需要用户在目标机上开 tunnel」过严：症状是空闲周期断连，用本地 relay + 两个 0.26.4 daemon + 真实 E2EE 客户端就能复现同一条 D2D 转发路径。2026-11-19 子代理实测 15 分钟两条并发转发 0 断连，空闲前后 HTTP 全 200，证据与可重跑脚本在 `.dev/tunnel-verify/`。生产 home 与 6777/6778/6779 全程未动，验证进程已全部清理。

未覆盖：托管 relay、亚秒级抖动（轮询间隔 1s，但 daemon socket 日志独立佐证无终止）、网络切换。

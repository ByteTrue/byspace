---
kind: work
status: in_progress
current_unit: "CI 与发布验收"
next_action: "提交工具链改动并由 CI 验证 Linux 入口"
must_hold: "不固定本机 Node，不改全局 Node/npm/PATH；不重打 v0.26.4"
proof_gap: "GitHub CI 尚未执行新入口；Docker 新构建未跑；heartbeat 工具不可用，未补建历史 heartbeat；未下载校验所有原生资产"
---

# 项目 npm 与 v0.26.4 验收

用户要求：「我全局就是要最新node lts的,那我用corepack来管你项目的版本总可以吧,反正不要影响到我全局」。确认采用项目局部 shim 后要求：「嗯,那就按你建议的落地吧.然后继续完成发版」。

项目固定 npm 10.9.9，不固定开发者 Node。CI 自己选择 Node 测试环境。局部 shim 只作用于入口启动的子进程。

| 行为路径 | 真实入口 | 操作 | 应观察到 | 证据 | 结果 |
|---|---|---|---|---|---|
| 项目 npm 与嵌套脚本 | node scripts/project-npm.mjs | 查询版本、运行包含 npm 的脚本及 version lifecycle | 全部 npm 10.9.9；全局版本和 PATH 不变 | node --test scripts/project-npm.test.mjs 通过；全局 npm -v 仍 12.2.2。旧的临时夹具仅 corepack npm 外层时内层返回 11.20.0，新入口内层返回 10.9.9 | 通过 |
| 安装幂等 | 同一入口 install | 比较 lockfile，连续执行 | lockfile 不变 | 两次 node scripts/project-npm.mjs run release:prepare 均 exit 0；MD5 均 29fdf786d288da17a58c9b8aef6e2549 | 通过 |
| CI 与本机同 npm | GitHub workflows | 检查各 setup-node 后的项目 npm 设置 | 使用 packageManager 声明；不更改 Node 测试环境 | 本地 setup-ci 写 GITHUB_PATH 已测；工作流远端待跑 | 无法判定 |
| v0.26.4 发布 | GitHub Release、Actions、托管站点、registry | 检查发布状态与资产 | 发布物、正文、镜像、部署可用 | 五个工作流成功；Release 正文逐字匹配批准 changelog；原生资产均非空且列在 SHA256SUMS；Windows CLI 下载哈希匹配；container.txt 哈希匹配；0.26.4 与 latest 均 digest 0fd66a6b77097e41852579c794600b1f4b6305f63fea2b355de0fbb51d2adb27；部署日志有真实 pairing 成功；历史 heartbeat 未建 | 无法判定 |

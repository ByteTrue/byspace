---
kind: note
title: "子进程环境必须剥离父进程的「身份」变量：pi 会话 + BySpace agent 作用域"
created: 2026-10-21
---

# 子进程环境里的身份变量

`internal/home/processenv.go` 的 `ExternalProcessEnv` 在把环境传给子进程前剔除一组
runtime-control 键。最初这份清单是从 Node 的 `byspace-env.ts` 移植的，只覆盖 supervisor
关系标记。本轮补进了两类**会改变子进程行为**的身份变量。

## 一、pi 自己的会话身份

```
PI_SESSION_FILE   PI_SESSION_ID   PI_MODEL   PI_PROVIDER
PI_REASONING_LEVEL   PI_CODING_AGENT
```

**为什么必须剥离**：daemon 可能是从 pi agent 内部启动的——本仓库的开发循环就是这样
（我在 pi 里跑 `./bin/byspace serve`）。这时父进程环境里有它自己那次 pi 会话的
`PI_SESSION_FILE`。子 pi 继承后**往父 transcript 里追加**，而不是开新会话。

实测：只用 daemon 的完整环境手动跑 pi，`text_delta` 从 5 个降到 1 个；逐项二分后锁定到
这几个变量。

## 二、BySpace 自己的 agent 作用域变量

```
BYSPACE_AGENT_ID   BYSPACE_AGENT_CWD
BYSPACE_SUBAGENT_REPORT_TOKEN   BYSPACE_SUBAGENT_REPORT_URL
```

这些描述的是「当前这个 agent」。孙进程继承后会把活动上报到错误的 agent。
`BYSPACE_SUBAGENT_REPORT_URL` 尤其危险：它是带端口的完整 URL，一个旧 daemon 的地址
会让子代理把状态报给另一台守护进程。

## 三、pi 的终端活动 marker（原清单里的，也最容易被忽略）

`BYSPACE_PI_TERMINAL_HOOK_OWNER_PID` 是**进程内去重 marker**。它泄漏进一个新终端后，
新起的 pi 读到不等于自己 pid 的值（尤其是死 pid）就认定自己是被继承的子进程，
**一个 handler 都不注册**，终端从此永远不上报 running/idle。
详见 `docs/terminal-activity.md`。

## 实现上的两条约定

1. **剥离在 overlay 之后**。调用点传 `map[string]string{"X": "v"}` 也塞不回来——
   这个不变量属于 `ExternalProcessEnv`，不属于每个调用点。
2. **每条都要有理由**。清单里每个键都应该能回答「不剥离会怎样」。
   加一条写不出后果的，说明它不属于这里。

## 守卫

`internal/home/processenv_test.go` 三条：
`TestExternalProcessEnvStripsRuntimeControls`、`...StripsAfterOverlays`、
`...StripsPiSessionIdentity`。第三条是本轮新增，直接锁住 pi 会话身份。

端到端验证方式：从带 `BYSPACE_PI_TERMINAL_HOOK_OWNER_PID=4242` 的 daemon 里开一个终端，
`echo $BYSPACE_PI_TERMINAL_HOOK_OWNER_PID` 必须是空。

---
kind: issue
title: "081 的 gate 漏了 windowsHide：CI 三次「绿」里两次是空的，一次是被取消的"
type: ff
status: closed
created: 2026-10-13
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 081 的 gate 漏了 windowsHide：CI 三次「绿」里两次是空的，一次是被取消的

> **读者：** 想知道「CI 绿」在什么情况下什么都没证明的人。

---

081 给 `test-utils/temp-github-repo.ts` 加 `execFileSync("gh", ...)` 时漏了 `windowsHide: true`。该文件在 `src/` 下、文件名不含 `.test.`，因此落在 `hidden-daemon-children.test.ts` 的扫描范围内（issue 053 的 Windows 控制台窗口规则）。`0c5149b48` 一推，两条 server-tests leg 同时红。

## 为什么前面三次都没抓到

| commit                  | 动了 server 源码 | 该 commit 的 CI | 守卫真跑了吗                                         |
| ----------------------- | ---------------- | --------------- | ---------------------------------------------------- |
| `44569766a`（引入违规） | 是               | **cancelled**   | 否 —— 被我下一次 push 取消                           |
| `18dfb085b`             | 否（docs-only）  | success         | 否 —— 路径过滤把 "Run server tests" 步骤 **skipped** |
| `407cdda32`             | 否（docs-only）  | success         | 否 —— 同上                                           |

`ci.yml` 的 `cancel-in-progress: true` 让连续 push 取消前一次运行；路径过滤又让 docs-only 的 commit 把 server 测试步骤标成 skipped，而 job 结论仍是 **success**（job 要保持固定名字供 required check 用）。于是「绿」既可能表示"跑过且通过"，也可能表示"根本没跑"。

## 值得记的一条

**看见 success 之前，先确认那个 job 的测试步骤是 success 而不是 skipped。** 区分方法：

```bash
gh run view <run-id> --json jobs \
  --jq '.jobs[] | select(.name|startswith("server-tests")) | .steps[] | "\(.conclusion)  \(.name)"'
```

本次就是这样定位的：`Run server tests  skipped`。

## 修法

`canCreateTempGithubRepos()` 的 `execFileSync` 加 `windowsHide: true`，并注释说明为什么 test-utils 也要遵守这条（它在 `src/` 下）。

## 验证

- `hidden-daemon-children.test.ts`：**3 passed**（三个用例都过，含"扫到的调用点"与"POSIX 豁免清单"两个反方向断言）。
- `typecheck` / `lint` / `format:check` 全绿。

## 对 `byissue/` 的影响

无。相关：[082](082-x-ff-windows-execsync-single-quotes.md)（同一批 Windows 测试基建修复）。

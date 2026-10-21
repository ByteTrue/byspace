---
kind: note
title: "Go 里「持锁调用会自己加锁的方法」这个坑复发三次，最后用 AST 检查兜住"
created: 2026-10-21
---

# 重复加锁：从注释到机械检查

## 三次复发

| 次  | 位置                                                                 | 后果                                                       |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | `handleEntryCaptureNotification` / `handleCommandResultNotification` | 扩展发 entry capture 就死锁，agent 完全静默（`notes/013`） |
| 2   | `attentionIsFocused`（我自己新写的注意力代码）                       | 轮次结束时死锁，agent 停在 running                         |
| 3   | `buildAgentSnapshotPayload`（`cancel_agent` 路径，早已存在）         | 取消请求挂死                                               |

第 1 次之后我加了注释、加了 `TestExtensionNotificationDoesNotDeadlock`。**没用。**
第 2 次是同一周内我自己在新代码里又犯的，而且注释就写在同一段代码上方不远。

## 为什么注释和单点测试不够

注释依赖下一个人读到它；单点测试只能覆盖被想到的那条路径。这个坑的特征是
「调用点看起来完全正常」——`s.buildAgentSnapshotPayload(rec)` 读起来是个纯函数式的
取值操作，没有任何迹象表明它会拿服务器锁。

## 有效的做法：AST 检查

`internal/server/lock_hygiene_test.go` 的 `TestNoReentrantServerLocks`：

1. 解析包内所有非测试文件的 AST
2. 维护一个「会自己加锁的方法名」清单（`selfLockingMethods`）
3. 在 `s.mu.Lock()` 与 `s.mu.Unlock()` 的词法区间内，出现清单里的调用就失败

它是**词法**的，不是流敏感的：看不懂在别的分支里解锁的情况，所以规则取保守值——
持锁区间内根本不要调这些方法。这个保守性是有意的：写起来的成本是多复制一次结构体，
而代价是「不会再有第四次」。

新增一个会自己加锁的方法时，把名字加进清单。**这是清单唯一的维护成本。**

## 教训

- 一条「不要这样做」的注释，不是防线。能编译成检查的东西才是。
- 复发两次以上的坑，值得写一个专门的静态检查，而不是第三次修补。
- 检查写完后必须做反向验证：把 bug 改回去，确认它红。第一次跑 `isServerMutex` 写错了
  （只认 `mu.Lock` 不认 `s.mu.Lock` 的两级选择器），检查静默通过；修正后才抓到两处。

# Windows 平台事实

## 结论

- Node 脚本取磁盘路径用 `fileURLToPath(import.meta.url)`，不用 `new URL(...).pathname`（Windows 上得到 `/C:/...`）；isMain 比较同样受影响。
- 汇总器只数 `--- FAIL:` 时，空输出会被误报全绿（scripts/audit.mjs 曾如此）：先确认子进程真的跑了、有输出，再信汇总。
- ConPTY 吞掉鼠标模式 ?1000h/?1002h/?1003h/?1006h，xterm.js 滚轮退回 ESC[A/ESC[B；真实 PTY 不受影响。实测 Win11 build 26300、go-pty v0.2.3。
- Windows 环境变量块保留创建者的大小写（Explorer 启动的进程是 `Path=`）；os.Getenv/LookPath 大小写不敏感所以探针看不见问题；手动遍历 []string 必须大小写不敏感比较，否则第二个 PATH 遮蔽真的 → exit 9009 / 'node' is not recognized。验证要读目标进程 PEB 环境（NtQueryInformationProcess，x64 ProcessParameters+0x20，Environment+0x80，UTF-16 双 NUL 结尾）。

## 依据

- 类型：外部观察（平台行为，实测）+ 可重跑证明（修复已落库）。
- 被否决的相关方案：用 URL.pathname 当磁盘路径；用大小写敏感的环境变量遍历；用 os.Getenv 探针验证子进程环境（探针与目标读法不同，掩盖问题）。
- 证据或复核方式：笔记 `byissue/archive/v1/notes/2026-11-04-windows-url-pathname-is-not-a-disk-path.md`（6 处已修）、`2026-11-11-windows-conpty-mouse-modes.md`、`2026-11-11-windows-env-block-key-case.md`。
- 适用条件：Windows 目标的全部脚本与 daemon 代码。ConPTY 结论绑定 go-pty v0.2.3（third_party/go-pty 是 pinned 库，升级前读其 README）。

## 重访条件

- go-pty 升级（重测鼠标模式）。
- Windows 版本/终端栈变化（ConPTY 行为可能随系统更新）。

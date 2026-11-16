---
type: ff
---

# Provider 常见安装目录兜底

## 做了什么

桌面 daemon 不继承终端 PATH 时，仍能检测并启动安装在 Homebrew 或用户本地目录中的 Provider。未运行登录 shell，未修改 daemon 的全局 PATH；仅 Provider 子进程追加缺失的常见目录，以支持 `#!/usr/bin/env node` 等解释器查找。

## 改了哪些

- `internal/execres/find.go`：在原 PATH 后追加 `/usr/local/bin`、`~/.local/bin`、`/opt/homebrew/bin`，显式路径保持字面值。
- Provider 检测和实际启动共用解析；Pi/Claude JSONL、Codex、ACP、OpenCode 子进程使用同一套 PATH 兜底。
- `internal/execres/find_test.go`、`internal/agent/providers/provider_command_test.go`：覆盖查找顺序、生产同款精简 PATH 和真实 `env node` 启动。

## 怎么验证的

- `go test ./internal/execres ./internal/agent/jsonl ./internal/agent/providers -count=1` 通过。
- `npm run typecheck`、`npm run lint` 通过。
- `npm run audit -- --no-browser` 全部通过；按参数跳过浏览器验证。
- 未重启或替换生产 daemon；界面生效需后续发布并重开桌面 App。

## 对 byissue/ 的影响

无影响。现有 spec 未改变。

## 顺手发现

`provider_diagnostic_request` 当前固定返回健康文案，未实际检查 Provider，不能作为此类问题的诊断证据。

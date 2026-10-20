# Go 版本对齐审计

Go 重写把 Node 的每个能力逐条翻译过来，所以「翻译漏了」是主要风险，而不是设计错误。
漏掉的东西有两个特点：**协议不报错，单元测试也不报错**，只在真实使用中表现为界面上少一块数据。

`npm run audit` 把这些检查串成一条命令。

## 为什么协议校验不够

`packages/protocol` 的功能字段几乎全是 `.optional()`。方向相反的两个漏法都不会触发校验：

- **入站漏解析**：客户端发了，Go 的 struct 没这个字段。`json.Unmarshal` 不报错，值静默丢失。
  真实案例：`project.create_directory` 读的是 `parentDirectory`，协议字段是 `parentPath`，
  于是新建的项目目录落到了 daemon 自己的工作目录下。
- **出站漏发送**：协议要求这个字段，Go 的 payload 里没有。`agent.lastUsage` 缺失让上下文
  用量环一直是空的；`agent_permission_request` 从未发送让 `ask_user` 弹窗永不出现。

## 四个检查，各挡一类

| 命令                      | 查什么                 | 失败意味着                       |
| ------------------------- | ---------------------- | -------------------------------- |
| `npm run test:go`         | 单测                   | 代码本身有问题                   |
| `npm run audit:go-parity` | 入站字段 Go 有没有接住 | 点了没反应                       |
| `npm run audit:emit`      | 出站字段 Go 有没有发全 | 界面上那块数据永远空着或显示旧值 |
| `npm run audit:browser`   | 真实 Chrome 里能不能用 | 页面报错、菜单缺项、状态不对     |

`audit:browser` 需要 daemon 在跑（`./bin/byspace daemon restart --addr 127.0.0.1:6778 --home .dev/byspace-home`）。

## 基线守卫

入站审计还有 47 条已知缺口，集中在 `hub.*`（远程托管未实现）、`plugin.*`（运行时不存）、
语音与听写（原生客户端能力）。这些不阻断交付，但**数字不许涨**。

`scripts/audit-baseline.json` 记录当前上限。涨了说明新写的 handler 又漏字段了，`.audit` 会失败并指出降级办法。
缺口真的修少了也要更新这个文件，否则守卫会一直报「已降到 N」。

## 出站审计能看多深

`scripts/go-emit-parity.mjs` 会**递归下钻**嵌套对象。这是必需的：`agent.lastUsage` 埋在
`agent` 里面，顶层字段全对，不下钻根本看不见。

验证方式是把赋值删掉再跑——它必须报出来。改这个脚本时，先做这个反向测试。

## 已知局限

出站审计有假阳性和假阴性，脚本头部注释写了两类：

- **假阳性**：payload 是变量（`respPayload := map[string]any{...}`）、同一类型多个发送分支时按并集判断
- **假阴性**：字段值来自循环里构造的切片、或经接口传递

所以它的输出值得人工确认，但不该因为怀疑假阳性就不看。

## 豁免要有理由

未实现的子系统在脚本里列进 `DEFERRED_TYPES`，**每条写清楚缺的是什么**。不要用 `_ = req.Field`
让审计变绿——那是把缺口藏起来，不是修掉。

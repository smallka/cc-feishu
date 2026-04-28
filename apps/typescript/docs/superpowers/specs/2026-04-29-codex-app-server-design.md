# Codex app-server 替换设计

**目标**

将当前 Codex 底层从 vendored `codex exec` wrapper 替换为官方 `codex app-server`，只完成现有核心能力的等价替换，不接入 `app-server` 的额外协议能力。

**范围**

- 使用 `codex app-server` 作为唯一 Codex 后端入口
- 通过 `stdio` 与 `app-server` 进行 JSON-RPC 通信
- 保留当前 `CodexMinimalSession` 对上层暴露的核心语义
- 支持单 session 内多轮对话
- 支持中断当前 turn，并在中断后继续下一轮
- 保留当前并发保护与 watchdog 活动回调语义

**不在范围内**

- `node codex.js app-server` fallback
- websocket transport
- 跨进程 `resumeSessionId` 恢复
- `/resume` 历史恢复链路
- `app-server` 额外能力接入，例如技能管理、文件系统 API、命令执行 API、审批 UI
- 借这次改造重写上层 agent / chat 业务接口

## 设计

### 1. 启动与传输层

Codex 基础版改为直接启动：

- `codex app-server`

交互方式固定为：

- `stdio`
- newline-delimited JSON
- JSON-RPC 2.0 request / response / notification

第一版依赖 `app-server` 默认的 `stdio://` 行为，不额外传 `--listen`。不引入额外 fallback，也不引入 websocket。实现前先做一个最小 smoke test，确认当前运行环境下直接启动 `codex app-server` 不会卡住。

### 2. 模块边界

保留 `src/codex-minimal/session.ts` 作为对上层的稳定外观，不改变 `CodexAgent` 和 `ChatManager` 当前依赖的接口。

新增两个内部模块：

- `src/codex-minimal/app-server-process.ts`
  - 负责启动和关闭 `codex app-server`
  - 管理 stdin / stdout / stderr 与进程退出状态
- `src/codex-minimal/app-server-rpc.ts`
  - 负责 request id 与 promise 的关联
  - 解析 JSONL
  - 分发 response、notification 和 server request

`CodexMinimalSession` 继续承担上层语义：

- `sendMessage()`
- `interrupt()`
- `getThreadId()`
- `isRunning()`
- 并发保护
- turn 生命周期与最终文本提取

### 3. Session 生命周期

`CodexMinimalSession` 内部状态机收敛为：

- `idle`
- `starting`
- `ready`
- `running`
- `stopping`
- `broken`

语义如下：

- `idle`：尚未启动 `app-server`，或当前没有活动 turn
- `starting`：正在完成 `app-server` 启动与 `initialize`
- `ready`：握手完成，且已拿到当前 `threadId`
- `running`：当前有活动 `turnId`
- `stopping`：已发送 `turn/interrupt`，等待本轮结束
- `broken`：进程退出、协议损坏、初始化失败；当前 session 失效，只能销毁重建

### 4. 线程与回合流程

第一次 `sendMessage()` 时懒启动 `app-server`，完成以下固定流程：

1. 启动 `codex app-server`
2. 发送 `initialize`
3. 发送 `initialized`
4. 发送 `thread/start`
5. 保存返回的 `threadId`
6. 发送 `turn/start`
7. 监听 `item/*` 与 `turn/*` notifications
8. 从最终 `agentMessage` 提取回复文本
9. 收到 `turn/completed` 后结束本轮

后续消息复用同一个 `threadId`，不重新创建 thread。

第一版不实现 `thread/resume`，也不承诺跨进程恢复历史 thread。

### 5. 通知处理

基础版优先支持 raw `app-server` notification，不兼容旧的 vendored `codex/event` 事件模型。

必须处理的通知：

- `turn/started`
- `turn/completed`
- `item/started`
- `item/completed`
- `error`

处理规则：

- `turn/started`：记录当前 `turnId`
- `turn/completed`：
  - `completed` 视为正常结束
  - `interrupted` 视为中断结束
  - `failed` 视为失败，并提取错误信息
- `item/completed(type=agentMessage)`：提取文本输出
- 顶层 `error` notification：
  - 仅记录终态错误
  - 不把“将自动重试”的临时错误覆盖成最终失败

为避免子线程或内部线程污染主流程，通知处理需按 `threadId` 过滤，只消费当前主线程的事件。

### 6. 中断语义

保留当前 `interrupt()` 对上层的语义：

- 无活动 turn 时返回 `false`
- 有活动 turn 时发送 `turn/interrupt(threadId, turnId)` 并返回 `true`
- 本轮最终映射为 `TurnAbortedError`
- 中断完成后 session 回到可继续对话状态

实现上不能再依赖本地 `AbortController` 直接终止子进程，而是要基于协议层的 `turn/interrupt` 完成回合中断。

### 7. 错误处理策略

第一版不保留“turn 失败后自动整轮重放”的行为。

原因：

- `app-server` 是持久连接
- turn 内可能已执行工具、副作用命令或文件修改
- 自动重放会放大副作用，风险高于当前一次性 `exec` 模型

因此错误策略定为：

- 启动前失败：允许一次冷启动级别重试
- `initialize` 或 `thread/start` 失败：当前 session 失败
- `turn/start` 之后的失败：不自动重放，直接失败
- 进程提前退出：当前 session 标为 `broken`
- 失败后的 session 由上层销毁；下一条消息重新创建新 session

为了避免“进程退出”掩盖真正原因，需要保留 stderr tail，并在握手失败或进程提前退出时拼接到错误信息中。

### 8. 对上层行为的影响

`CodexAgent` 和普通消息流的核心接口不应变化，但 Codex provider 的历史恢复能力需要明确降级：

- 基础版不支持跨进程 `resumeSessionId`
- 基础版不承诺 `/resume` 对 Codex 可用
- 基础版不承诺根据已记录 session 自动恢复历史 thread

实现时应避免继续对外暴露“已支持恢复”的错误语义。Claude 路径不受影响。

### 9. 测试策略

继续复用 `src/codex-minimal/verify.ts` 作为主要验证脚本，但内容改为 app-server 版本。基础版至少覆盖：

- `codex app-server` 能完成最小握手
- 非 Git 目录里首轮消息成功
- 同一 session 阻止并发 turn
- `interrupt()` 能中断当前 turn
- 中断后同一 `threadId` 还能继续下一轮

人工 smoke test 只验证最小对话链路：

- 普通短消息得到固定回复
- 长消息中断后能继续发送下一条

不再把 `resumeSessionId` 恢复放入第一版验收。

### 10. 参考实现

实现策略参考 `C:\work\agent-mgr\multica` 的 Codex backend，重点借鉴以下决策：

- `codex app-server --listen stdio://` + JSON-RPC over stdio
- `initialize` / `initialized` 握手
- stderr tail
- `turn/completed` 错误采集
- `threadId` 过滤，避免子线程通知污染主线程

但不照搬其“一次 Execute 结束即关闭 app-server”的生命周期。当前项目需要的是长期驻留的 chat session，而不是一次执行一进程。

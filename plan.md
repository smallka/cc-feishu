# 最小可行方案：飞书机器人接入 Claude Code

## 目标

通过飞书机器人与 Claude Code CLI 交互。用户在飞书群里发消息，机器人将消息转发给 Claude Code，收到回复后发回飞书。

## 核心架构

```
飞书用户 → 飞书服务器 → (SDK WebSocket) → cc-feishu bot
                                              ↓
                                        SessionManager (每个 chat 一个 session)
                                              ↓
                                        Claude Code CLI (--sdk-url ws://localhost:PORT/ws/cli/SESSION_ID)
                                              ↓
                                        本地 WebSocket Server (ws 库)
                                              ↓
                                        CLIBridge (NDJSON 协议解析，消息收集，自动审批)
```

## MVP 功能范围

- 用户发文本消息 → 转发给 Claude Code → 收集完整回复 → 发回飞书
- 每个飞书 chat 维护一个 Claude Code session
- 工具权限自动批准（`--permission-mode plan` 或自动回复 allow）
- 回复过长时自动截断（飞书消息有长度限制）

## 不做的事

- 不做流式输出（飞书不支持消息编辑流式更新）
- 不做 git 集成、任务追踪、diff 查看
- 不做多 session 管理 UI
- 不做卡片消息交互

## 实现步骤

### 1. 安装依赖

添加 `ws` 和 `@types/ws` 用于本地 WebSocket 服务器。

### 2. 新建 `src/claude/types.ts`

从 companion 的 session-types.ts 中提取 MVP 所需的类型定义：
- `CLIMessage` 联合类型（system/assistant/result/control_request/stream_event/keep_alive）
- `ContentBlock` 类型
- 简化的 `SessionState`

### 3. 新建 `src/claude/ws-server.ts`

本地 WebSocket 服务器，监听一个端口（如 9800）：
- 路由 `/ws/cli/:sessionId` — Claude Code CLI 连接到这里
- 收到 CLI 连接时，通知 SessionManager
- 收到 CLI 消息时（NDJSON），解析并路由到对应 session 的 bridge

### 4. 新建 `src/claude/bridge.ts`

每个 session 一个 bridge 实例，负责：
- 维护 CLI WebSocket 连接引用
- 解析 NDJSON 消息（system/assistant/result/control_request）
- 收集 assistant 消息中的 text 内容块
- 收到 result 时，将收集的文本合并，通过回调通知上层
- 收到 control_request（权限请求）时，自动回复 allow
- 提供 `sendUserMessage(text)` 方法，将用户消息转为 NDJSON 发给 CLI
- 消息队列：CLI 未连接时缓存消息

### 5. 新建 `src/claude/launcher.ts`

启动 Claude Code CLI 进程：
- 使用 `child_process.spawn` 启动 `claude` 命令
- 参数：`--sdk-url ws://localhost:9800/ws/cli/{sessionId} --print --output-format stream-json --input-format stream-json --verbose -p ""`
- 监控进程退出
- 提供 kill 方法

### 6. 新建 `src/claude/session-manager.ts`

管理 chat → session 的映射：
- `getOrCreateSession(chatId)` — 获取或创建 session
- 创建 session 时：生成 sessionId，创建 bridge，启动 CLI 进程
- 注册 bridge 的 onResponse 回调，收到回复时调用飞书消息服务发送
- 提供 `sendMessage(chatId, text)` 方法

### 7. 修改 `src/handlers/message.handler.ts`

将原来的 echo 逻辑替换为：
- 收到用户消息后，调用 `sessionManager.sendMessage(chatId, text)`
- 支持 `/new` 命令重置 session
- 支持 `/status` 命令查看 session 状态

### 8. 修改 `src/services/message.service.ts`

- 消息过长时分段发送（飞书单条消息限制约 4000 字符）

### 9. 修改 `src/index.ts`

- 启动时初始化 WebSocket 服务器和 SessionManager
- 关闭时清理所有 session

## 文件清单

| 文件 | 操作 |
|------|------|
| `package.json` | 添加 ws, @types/ws 依赖 |
| `src/claude/types.ts` | 新建 |
| `src/claude/ws-server.ts` | 新建 |
| `src/claude/bridge.ts` | 新建 |
| `src/claude/launcher.ts` | 新建 |
| `src/claude/session-manager.ts` | 新建 |
| `src/handlers/message.handler.ts` | 修改 |
| `src/services/message.service.ts` | 修改 |
| `src/index.ts` | 修改 |
| `src/config/index.ts` | 修改（添加 WS_PORT 配置） |

# 飞书机器人 - 开发指南

基于 Python 的飞书机器人，通过 WebSocket 接收消息，通过 stdin/stdout 管道与 Claude Code CLI 通信。

## 技术栈

- Python 3.10+
- `claude-agent-sdk` - Claude Code CLI 官方 SDK
- `lark-oapi` - 飞书 Python SDK
- `asyncio` - 异步框架
- `logging` - 标准库日志

## 项目结构

```
src/
├── main.py                     # 入口
├── config/
│   └── __init__.py            # 配置管理
├── bot/
│   ├── client.py              # 飞书客户端
│   ├── websocket.py           # WebSocket 连接
│   └── chat_manager.py        # 会话管理（chat → agent 映射）
├── claude/
│   └── agent.py               # Agent 封装（单个 CLI 进程）
├── handlers/
│   └── message_handler.py     # 消息处理
├── services/
│   └── message_service.py     # 消息发送
└── utils/
    └── logger.py              # 日志配置
```

## 核心架构

### 职责分工

**message_handler.py**：
- 消息路由和业务逻辑协调
- 解析用户消息（命令 vs 普通消息）
- 处理命令（/help, /new, /stop, /stat, /cd, /resume, /debug 等）
- 管理 Reaction 生命周期（添加/移除）
- 处理 Session 变化通知

**ChatManager** (`src/bot/chat_manager.py`)：
- Agent 生命周期管理
- 管理 chat → agent 映射
- 创建/销毁/重置 Agent
- Session 管理（列出/恢复历史 sessions）
- 不涉及业务逻辑（reaction、通知等）

**Agent** (`src/claude/agent.py`)：
- 封装单个 Claude Code CLI 进程
- 管理消息队列（自动排队，避免拒绝）
- 使用 `claude-agent-sdk` 的 `ClaudeSDKClient`
- 自动批准工具权限（`permission_mode='bypassPermissions'`）

**MessageService** (`src/services/message_service.py`)：
- 飞书消息发送（文本/卡片）
- Reaction 管理（添加/移除）
- 不涉及业务逻辑

### 消息流转

```
用户消息 → 飞书服务器 → WebSocket → MessageHandler
  ↓
  添加 Reaction (Typing)
  ↓
  ChatManager.send_message(chat_id, message_id, text)
  ↓
  Agent.send_message(message_id, text) [入队]
  ↓
  后台任务从队列取出消息
  ↓
  ClaudeSDKClient (stdin 写入)
  ↓
  Claude Code CLI 进程
  ↓
  ClaudeSDKClient (stdout 读取)
  ↓
  收集 assistant 消息
  ↓
  触发回调 → MessageService.send_text_message
  ↓
  飞书服务器 → 用户
  ↓
  MessageHandler 移除 Reaction
```

### 会话管理

**ChatManager 数据结构**：
- `chats: Dict[chat_id, ChatData]` - 存储会话元数据（cwd, session_id, session_notified）
- `agents: Dict[chat_id, Agent]` - 管理 Agent 进程实例

**Chat 与 Agent 的关系**：
- 一个 chat 对应一个 ChatData（持久化元数据）
- 一个 chat 同一时间最多一个 Agent（进程实例）
- Agent 可能不存在（未创建或已销毁），但 ChatData 可以保留

**状态变化**：
- **首次消息**：创建 Agent，在 default_cwd 启动新会话
- **后续消息**：复用存活的 Agent，或重启并 resume session_id
- **`/cd` 切换目录**：销毁 Agent，清空 session_id，更新 cwd（下次消息创建新会话）
- **`/ls` 列出 sessions**：读取 `~/.claude/projects/<cwd>/` 目录下的 `.jsonl` 文件，按时间倒序显示
- **`/resume` 恢复会话**：销毁当前 Agent，更新 session_id，下次消息时恢复到指定 session
- **`/new` 重置**：销毁 Agent，删除 ChatData（下次消息在当前 cwd 创建新会话）
- **Agent 进程死亡**：下次消息时自动清理并重启

### 消息队列机制

**Agent 内部队列**：
- 消息自动排队，不会被拒绝
- 串行处理，保证顺序
- `/stop` 中断当前任务并清空队列
- 队列存储 `(message_id, text)` 元组

### 命令处理

**message_handler.py**：
- `/help` - 显示命令列表
- `/new` - 调用 `ChatManager.reset(chat_id)`，关闭当前 Agent 并创建新的
- `/stop` - 调用 `ChatManager.interrupt(chat_id)`，中断当前任务
- `/stat` - 调用 `ChatManager.get_session_info(chat_id)`，返回当前 session ID 和工作目录
- `/cd <路径>` - 调用 `ChatManager.switch_cwd(chat_id, new_cwd)`，切换工作目录并显示 sessions（`/cd .` 切换到根目录）
- `/resume` - 调用 `ChatManager.list_sessions(chat_id)`，列出可用的 sessions
- `/resume <编号|session_id>` - 调用 `ChatManager.resume_session(chat_id, session_id)`，恢复到指定 session（支持编号索引）
- `/debug` - 显示系统状态（Agent 数量、内存使用等）

### 工具权限自动批准

使用 SDK 的 `permission_mode='bypassPermissions'` 自动批准所有工具调用，无需手动处理。

## 开发规范

### 日志规范

使用标准库 `logging`，必须包含上下文：

```python
# 好
logger.info('[ChatManager] Creating agent', extra={
    'chat_id': chat_id,
    'cwd': cwd,
    'operation': 'create'
})

# 差
logger.info('Creating agent')
```

**关键字段**：
- `chat_id` - 飞书 chat ID
- `agent_id` - agent ID
- `session_id` - Claude session ID
- `cwd` - 工作目录
- `operation` - 操作类型
- **不记录消息内容**（隐私保护）

### 异步编程规范

- 所有 I/O 操作使用 `async/await`
- 使用 `asyncio.create_task()` 创建后台任务
- 使用 `asyncio.Queue` 进行任务间通信
- 正确处理 `CancelledError` 和超时

### 错误处理

- 捕获具体异常，避免裸 `except`
- 记录完整堆栈信息（`logger.exception()`）
- 向用户返回友好的错误提示
- 区分可恢复错误和致命错误

### 资源管理

- Agent 进程必须正确关闭（`agent.close()`）
- WebSocket 断开时清理所有 Agent
- 使用 `try/finally` 确保资源释放

## 技术细节

### Claude SDK 集成

使用官方 `claude-agent-sdk`：

```python
from claude_agent_sdk import ClaudeSDKClient

client = ClaudeSDKClient(
    cwd=working_directory,
    session_id=session_id,  # 可选，用于恢复会话
    permission_mode='bypassPermissions'  # 自动批准工具
)

# 发送消息
await client.send_message(text)

# 中断
await client.interrupt()

# 关闭
await client.close()
```

### 会话持久化

- `session_id` 存储在 `ChatData` 中
- Agent 重启时通过 `session_id` 恢复上下文
- `/cd` 切换目录会清空 `session_id`（新会话）
- `/new` 删除整个 `ChatData`（完全重置）

### 重启策略

**重要**：当 WebSocket 连接断开时，应用会主动退出（exit code 1），依赖外部进程管理器（systemd/supervisor）自动重启。这是设计行为，确保连接问题能够快速恢复。

## 参考文档

- [README.md](README.md) - 使用指南和快速开始
- [INSTALL.md](INSTALL.md) - 安装配置指南
- [docs/PROTOCOL_SPEC.md](docs/PROTOCOL_SPEC.md) - Claude Code 完整协议规范

## 许可证

MIT

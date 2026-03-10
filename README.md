# 飞书机器人 - Claude Code 交互

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
│   └── index.py               # 配置管理
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

deploy/
├── systemd/
│   └── feishu-bot.service     # systemd 配置示例
└── supervisor/
    └── feishu-bot.conf        # supervisor 配置示例
```

## 快速开始

详见 [INSTALL.md](INSTALL.md)

```bash
# 安装依赖
pip install -e .

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入飞书凭证

# 启动
python -m src.main
```

## 核心交互逻辑

### 消息流转

```
用户消息 → 飞书服务器 → WebSocket → message_handler
  → ChatManager.send_message(chat_id, text)
  → Agent.send_message(text)
  → ClaudeSDKClient (stdin 写入)
  → Claude Code CLI 进程
  → ClaudeSDKClient (stdout 读取)
  → 收集 assistant 消息
  → 触发回调
  → MessageService.send_text_message
  → 飞书服务器 → 用户
```

### 会话管理

**ChatManager** (`src/bot/chat_manager.py`)：

**数据结构**：
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
- **`/new` 重置**：销毁 Agent，删除 ChatData（下次消息在当前 cwd 创建新会话）
- **Agent 进程死亡**：下次消息时自动清理并重启

**Agent** (`src/claude/agent.py`)：
- 封装单个 Claude Code CLI 进程
- 使用 `claude-agent-sdk` 的 `ClaudeSDKClient`
- 提供 `send_message()` / `interrupt()` / `close()` 接口
- 自动批准工具权限（`permission_mode='bypassPermissions'`）

### 命令处理

**message_handler.py**：
- `/help` - 显示命令列表
- `/new` - 调用 `ChatManager.reset(chat_id)`，关闭当前 Agent 并创建新的
- `/stop` - 调用 `ChatManager.interrupt(chat_id)`，中断当前任务
- `/stat` - 调用 `ChatManager.get_session_info(chat_id)`，返回当前 session ID 和工作目录
- `/cd [路径]` - 调用 `ChatManager.switch_cwd(chat_id, new_cwd)`，切换工作目录并 resume session
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

## 部署

### 使用 systemd（推荐）

```bash
sudo cp deploy/systemd/feishu-bot.service /etc/systemd/system/
# 编辑文件修改路径和用户
sudo systemctl daemon-reload
sudo systemctl enable feishu-bot
sudo systemctl start feishu-bot
```

### 使用 supervisor

```bash
sudo cp deploy/supervisor/feishu-bot.conf /etc/supervisor/conf.d/
# 编辑文件修改路径和用户
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start feishu-bot
```

详见 [INSTALL.md](INSTALL.md)

## 重启策略

**重要**：当 WebSocket 连接断开时，应用会主动退出（exit code 1），依赖外部进程管理器（systemd/supervisor）自动重启。这是设计行为，确保连接问题能够快速恢复。

## 迁移说明

如果你从 TypeScript 版本迁移，请参考 [MIGRATION.md](MIGRATION.md)。

## 参考文档

- [INSTALL.md](INSTALL.md) - 安装配置指南
- [MIGRATION.md](MIGRATION.md) - TypeScript → Python 迁移指南
- [docs/PROTOCOL_SPEC.md](docs/PROTOCOL_SPEC.md) - Claude Code 完整协议规范

## 许可证

MIT

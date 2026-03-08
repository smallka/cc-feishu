# 飞书机器人 - Claude Code 交互

基于 TypeScript 的飞书机器人，通过 WebSocket 接收消息，通过 stdin/stdout 管道与 Claude Code CLI 通信。

## 架构设计

### 核心分层
```
Chat（会话控制层）
  ├─ 元数据：cwd, sessionId
  ├─ 指令处理：/new, /cd, /stop
  └─ Agent（进程执行层）
      ├─ CLI 进程
      ├─ 消息收发
      └─ 生命周期
```

**设计思路**：
- **Chat 层**提供兜底命令（`/new`, `/cd`），让用户清理异常状态
- **Agent 层**专注进程管理，不处理复杂边界情况
- 避免在每层实现复杂的错误处理和状态管理
- 让用户感知异常，不在底层默默处理错误

**异常处理**：
- Agent 进程崩溃 → 下次消息自动重启
- 状态混乱 → 用户执行 `/new` 重置
- 目录切换 → `/cd` 销毁旧 Agent，创建新会话

### 消息流转

```
用户消息 → 飞书 WebSocket → message.handler
  → ChatManager.sendMessage(chatId, text)
  → Agent.sendMessage(text)
  → CLIBridge (stdin 写入 NDJSON)
  → Claude Code CLI 进程
  → CLIBridge (stdout 读取 NDJSON)
  → 收集 assistant 消息
  → 收到 result 触发回调
  → MessageService.sendTextMessage
  → 飞书服务器 → 用户
```

## 核心模块

### ChatManager (`src/bot/chat-manager.ts`)

**数据结构**：
- `chats: Map<chatId, ChatData>` - 会话元数据（cwd, sessionId）
- `agents: Map<chatId, Agent>` - Agent 进程实例

**关系**：
- 一个 chat 对应一个 ChatData（持久化）
- 一个 chat 最多一个 Agent（可能不存在）

**状态变化**：
- 首次消息：创建 Agent，在 defaultCwd 启动新会话
- 后续消息：复用 Agent，或重启并 resume sessionId
- `/cd`：销毁 Agent，清空 sessionId，更新 cwd
- `/new`：销毁 Agent，删除 ChatData
- Agent 死亡：下次消息自动重启

### Agent (`src/claude/agent.ts`)

封装单个 CLI 进程，提供：
- `sendMessage()` - 发送消息
- `interrupt()` - 中断执行
- `close()` - 关闭进程

### CLIBridge (`src/claude/bridge.ts`)

解析 stdio NDJSON 协议：
- 收集 `assistant` 消息文本
- 自动批准 `control_request/can_use_tool`
- 收到 `result` 触发回调

### Launcher (`src/claude/launcher.ts`)

启动 CLI 进程：
- 命令：`claude chat --input-format stream-json --output-format stream-json`
- 可选：`--resume <session-id>`
- 清除 `CLAUDECODE` 环境变量

## 命令

- `/help` - 显示命令列表
- `/new` - 重置会话
- `/stop` - 中断执行
- `/stat` - 显示 session ID 和工作目录
- `/cd [路径]` - 切换工作目录

## 项目结构

```
src/
├── bot/
│   ├── client.ts              # 飞书客户端
│   ├── websocket.ts           # WebSocket 连接
│   └── chat-manager.ts        # 会话管理
├── claude/
│   ├── types.ts               # NDJSON 协议类型
│   ├── agent.ts               # Agent 封装
│   ├── launcher.ts            # CLI 进程启动
│   ├── bridge.ts              # stdio 协议解析
│   └── session-scanner.ts     # 扫描已有 session
├── handlers/
│   └── message.handler.ts     # 消息处理
├── services/
│   └── message.service.ts     # 消息发送
└── utils/
    └── logger.ts              # 日志
```

## 开发规范

### 日志

使用 Winston 结构化日志，必须包含上下文：

```typescript
logger.info('[ChatManager] Creating agent', {
  chatId,
  cwd,
  operation: 'create'
});
```

关键字段：`chatId`, `agentId`, `sessionId`, `cwd`, `operation`（不记录消息内容）

## 快速开始

```bash
npm install
cp .env.example .env
# 编辑 .env 填入飞书凭证
npm run dev
```

详见 [INSTALL.md](INSTALL.md)

## 参考文档

- [docs/PROTOCOL_SPEC.md](docs/PROTOCOL_SPEC.md) - Claude Code 完整协议规范
- [docs/CLI_PERMISSION_RULES.md](docs/CLI_PERMISSION_RULES.md) - 权限处理与设计原则
- [docs/STDIO_QUICKSTART.md](docs/STDIO_QUICKSTART.md) - stdio 通信快速上手
- [docs/PYTHON_SDK_ANALYSIS.md](docs/PYTHON_SDK_ANALYSIS.md) - Python SDK 实现分析

## 技术栈

- TypeScript 5.3+ / Node.js 18+
- `@larksuiteoapi/node-sdk` - 飞书 SDK
- `winston` - 日志

## 许可证

MIT

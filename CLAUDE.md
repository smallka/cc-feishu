# 飞书机器人 - Claude Code 交互

基于 TypeScript 的飞书机器人，通过 WebSocket 接收消息，通过 stdin/stdout 管道与 Claude Code CLI 通信。

## 技术栈

- TypeScript 5.3+ / Node.js 18+
- `@larksuiteoapi/node-sdk` - 飞书 SDK
- `winston` - 日志

## 项目结构

```
src/
├── index.ts                    # 入口
├── config/index.ts             # 配置
├── bot/
│   ├── client.ts              # 飞书客户端
│   ├── websocket.ts           # WebSocket 连接
│   └── chat-manager.ts        # 会话管理（chat → agent 映射）
├── claude/
│   ├── types.ts               # NDJSON 协议类型
│   ├── agent.ts               # Agent 封装（单个 CLI 进程）
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

## 快速开始

详见 [INSTALL.md](INSTALL.md)

```bash
npm install
cp .env.example .env
# 编辑 .env 填入飞书凭证
npm run dev
```

## 核心交互逻辑

### 消息流转

```
用户消息 → 飞书服务器 → WebSocket → message.handler
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

### 会话管理

**ChatManager** (`src/bot/chat-manager.ts`)：
- 维护 `Map<chatId, ChatData>` 存储会话信息（cwd, sessionId）
- 维护 `Map<chatId, Agent>` 管理 Agent 实例
- 每个 chat 同一时间只有一个 Agent（按 cwd 切换）
- `/cd` 切换目录时：
  1. 销毁当前 Agent
  2. 更新 ChatData 的 cwd
  3. 下次消息时创建新 Agent 并自动 resume 该目录的 sessionId
- 首次响应时检测 session 变化并通知用户

**Agent** (`src/claude/agent.ts`)：
- 封装单个 Claude Code CLI 进程
- 通过 Launcher 启动进程
- 通过 Bridge 解析 stdio 协议
- 提供 `sendMessage()` / `interrupt()` / `close()` 接口

**CLIBridge** (`src/claude/bridge.ts`)：
- 解析 stdin/stdout 的 NDJSON 协议
- 收集 `assistant` 消息中的文本内容
- 自动批准 `control_request/can_use_tool`
- 收到 `result` 时触发回调返回完整响应

**Launcher** (`src/claude/launcher.ts`)：
- 启动 `claude chat` 子进程
- 参数：`--input-format stream-json --output-format stream-json`
- 可选：`--resume <session-id>` 恢复会话
- 清除 `CLAUDECODE` 环境变量防止嵌套检测

### 命令处理

**message.handler.ts**：
- `/help` - 显示命令列表
- `/new` - 调用 `ChatManager.reset(chatId)`，关闭当前 Agent 并创建新的
- `/stop` - 调用 `ChatManager.interrupt(chatId)`，向 CLI stdin 写入中断信号
- `/stat` - 调用 `ChatManager.getSessionInfo(chatId)`，返回当前 session ID 和工作目录
- `/cd [路径]` - 调用 `ChatManager.switchCwd(chatId, newCwd)`，切换工作目录并 resume session

### 工具权限自动批准

CLIBridge 收到 `control_request/can_use_tool` 时：

```typescript
{
  type: 'control_request',
  subtype: 'can_use_tool',
  tool: { name: 'Read', input: { file_path: '...' } }
}
```

自动响应：

```typescript
{
  type: 'control_response',
  subtype: 'can_use_tool',
  approved: true,
  updatedInput: tool.input  // 必须返回
}
```

## 开发规范

### 日志规范

使用 Winston 结构化日志，必须包含上下文：

```typescript
// 好
logger.info('[ChatManager] Creating agent', {
  chatId,
  cwd,
  operation: 'create'
});

// 差
logger.info('Creating agent');
```

**关键字段**：
- `chatId` - 飞书 chat ID
- `agentId` - agent ID
- `sessionId` - Claude session ID
- `cwd` - 工作目录
- `operation` - 操作类型
- **不记录消息内容**（隐私保护）

## 技术规范

- [docs/PROTOCOL_SPEC.md](docs/PROTOCOL_SPEC.md) - Claude Code 完整协议规范（NDJSON over stdio/WebSocket）

## 参考文档

- [INSTALL.md](INSTALL.md) - 安装配置指南
- [docs/STDIO_QUICKSTART.md](docs/STDIO_QUICKSTART.md) - stdio 通信快速上手
- [docs/PYTHON_SDK_ANALYSIS.md](docs/PYTHON_SDK_ANALYSIS.md) - Python SDK 实现分析

## 许可证

MIT

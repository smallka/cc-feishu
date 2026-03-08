# 飞书机器人 - Claude Code 交互

基于 TypeScript 和 Node.js 的飞书机器人，通过 WebSocket 长连接接收飞书消息，通过 stdin/stdout 管道与 Claude Code CLI 进程通信实现 AI 对话交互。

## 技术栈

- **语言**: TypeScript 5.3+
- **运行时**: Node.js 18+
- **核心依赖**:
  - `@larksuiteoapi/node-sdk`: 飞书官方 SDK
  - `winston`: 结构化日志
  - `dotenv`: 环境变量管理

## 项目结构

```
cc-feishu/
├── src/
│   ├── index.ts                 # 应用入口
│   ├── config/
│   │   └── index.ts            # 配置管理
│   ├── bot/
│   │   ├── client.ts           # 飞书客户端
│   │   └── websocket.ts        # 飞书 WebSocket 连接管理
│   ├── bot/
│   │   ├── client.ts           # 飞书客户端
│   │   ├── websocket.ts        # 飞书 WebSocket 连接管理
│   │   └── chat-store.ts       # Chat 会话信息内存存储
│   ├── claude/
│   │   ├── types.ts            # Claude Code CLI NDJSON 协议类型
│   │   ├── bridge.ts           # CLI 消息桥接（stdin/stdout 协议解析、自动审批）
│   │   ├── launcher.ts         # Claude Code CLI 进程管理（stdio 模式）
│   │   ├── session-manager.ts  # 会话管理（chat+cwd → session 映射）
│   │   └── session-scanner.ts  # 会话扫描和恢复
│   ├── handlers/
│   │   └── message.handler.ts  # 消息事件处理
│   ├── services/
│   │   ├── message.service.ts  # 消息发送服务
│   │   └── streaming-card.ts   # 流式卡片（Card Kit streaming）
│   └── utils/
│       └── logger.ts           # 日志工具
├── .env                         # 环境变量（需自行创建）
├── .env.example                 # 环境变量模板
├── package.json
├── tsconfig.json
└── CLAUDE.md                    # 本文档
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填入你的飞书应用凭证：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxx
CLAUDE_WORK_ROOT=/path/to/your/projects
CLAUDE_MODEL=claude-opus-4-6
STREAMING_ENABLED=true
STREAMING_THROTTLE_MS=150
NODE_ENV=development
LOG_LEVEL=info
```

### 3. 飞书开放平台配置

在 [飞书开放平台](https://open.feishu.cn) 进行以下配置：

1. **启用机器人能力**
   - 进入应用管理
   - 启用机器人功能

2. **配置事件订阅**
   - 进入"事件与回调"
   - 选择"使用长连接接收事件/回调"（WebSocket 模式）
   - 订阅 `im.message.receive_v1` 事件

3. **配置权限**
   - 添加 `im:message` 权限（接收消息）
   - 添加 `im:message:send_as_bot` 权限（发送消息）
   - 添加 `cardkit:card:write` 权限（创建与更新卡片，流式输出需要）

4. **发布应用**
   - 发布应用并在企业内可用

5. **添加机器人到群组**
   - 创建测试群组
   - 将机器人添加到群组

### 前置条件

- 本机已安装 Claude Code CLI（`claude` 命令可用）
- Claude Code 已完成认证登录

### 4. 启动机器人

开发模式（热重载）：
```bash
npm run dev
```

生产模式：
```bash
npm run build
npm start
```

## 功能特性

### 当前功能

- ✅ 飞书 WebSocket 长连接（自动重连和心跳）
- ✅ Claude Code CLI 集成（通过 stdin/stdout 管道通信）
- ✅ 每个飞书 chat 独立 Claude Code 会话
- ✅ 工作目录切换（`/cd`），每个目录独立 session
- ✅ 会话恢复（`--resume` 参数）
- ✅ 工具权限自动批准
- ✅ 长消息自动分段发送（飞书 4000 字符限制）
- ✅ 消息去重（防止飞书重复投递）
- ✅ 流式输出（Card Kit streaming，打字机效果实时显示）
- ✅ 命令支持（`/help`、`/new`、`/status`、`/cd`）
- ✅ 结构化日志记录
- ✅ 优雅关闭（Ctrl+C）

### 核心交互流程

```
飞书用户发消息 → 飞书服务器 → (SDK WebSocket) → cc-feishu bot
    → SessionManager → Claude Code CLI 进程 (stdin/stdout)
    → CLIBridge (NDJSON 协议解析)
    → 流式卡片实时更新（Card Kit streaming）
    → CLI 返回 result → 关闭流式模式 → 最终卡片
```

### 命令

- `/help`: 显示可用命令列表
- `/new`: 重置当前工作目录的 Claude Code 会话
- `/status`: 查看当前会话状态和工作目录
- `/cd`: 列出所有已记录的工作目录
- `/cd <路径>`: 切换工作目录（绝对路径或相对于 `CLAUDE_WORK_ROOT` 的路径），每个目录有独立的 session

## 核心模块说明

### 飞书 WebSocket 连接管理 (`src/bot/websocket.ts`)

负责管理飞书 SDK WebSocket 长连接：
- 创建 WSClient 实例
- 注册事件处理器
- 自动处理心跳和重连
- 优雅关闭连接

### Claude Code 会话管理 (`src/claude/session-manager.ts`)

管理飞书 chat 到 Claude Code session 的映射：
- 每个 (chat, 工作目录) 维护独立的 Claude Code 进程和会话
- 支持 `/cd` 切换工作目录，自动 resume 已有 session
- 自动创建/复用会话
- 回复过长时自动分段发送
- 优雅关闭所有会话

### Claude Code CLI 桥接 (`src/claude/bridge.ts`)

每个 session 一个 bridge 实例：
- 通过 stdin/stdout 管道与 CLI 进程通信
- 解析 NDJSON 协议消息（system/assistant/result/control_request）
- 收集 assistant 消息中的文本内容
- 收到 result 时合并文本通过回调通知上层
- 自动批准工具权限请求

### Claude Code CLI 启动器 (`src/claude/launcher.ts`)

管理 Claude Code CLI 子进程：
- 使用 `--input-format stream-json` 和 `--output-format stream-json` 参数
- 通过 stdin/stdout 管道进行 NDJSON 通信
- 支持 `--resume` 参数恢复已有会话
- 清除 `CLAUDECODE` 环境变量防止嵌套检测
- 进程退出监控和清理

### 消息处理器 (`src/handlers/message.handler.ts`)

处理接收到的消息事件：
- 消息去重（基于 message_id）
- 解析消息内容
- 命令分发（`/new`、`/status`、`/cd`）
- `/cd` 路径解析（绝对路径或基于 `CLAUDE_WORK_ROOT` 的相对路径）
- 转发用户消息到 Claude Code 会话

### 消息服务 (`src/services/message.service.ts`)

封装消息发送 API：
- 发送文本消息
- 统一错误处理
- 日志记录

### 流式卡片 (`src/services/streaming-card.ts`)

基于飞书 Card Kit API 实现流式输出：
- 创建流式卡片实体（`streaming_mode: true`）
- 节流更新卡片内容（默认 150ms，最多 10次/秒）
- Promise 队列串行化更新请求
- 关闭流式模式并更新摘要
- 失败时自动降级为纯文本发送

### 配置管理 (`src/config/index.ts`)

集中管理应用配置：
- 加载环境变量
- 验证必需配置
- 提供类型安全的配置访问
- Claude Code 工作根目录配置（`CLAUDE_WORK_ROOT`，默认 `process.cwd()`）
- Claude Code 模型配置（`CLAUDE_MODEL`，默认 `claude-opus-4-6`）
- 流式输出开关（`STREAMING_ENABLED`，默认 true）
- 流式更新节流间隔（`STREAMING_THROTTLE_MS`，默认 150ms）

### 日志工具 (`src/utils/logger.ts`)

提供结构化日志：
- 彩色控制台输出
- 时间戳和日志级别
- 错误堆栈跟踪

## 开发指南

### 添加新的消息类型支持

1. 在 `src/handlers/message.handler.ts` 中添加处理逻辑：

```typescript
if (message.message_type === 'image') {
  // 处理图片消息
}
```

2. 在 `src/services/message.service.ts` 中添加发送方法：

```typescript
async sendImageMessage(chatId: string, imageKey: string): Promise<void> {
  // 实现图片消息发送
}
```

### 添加新的事件处理

在 `src/bot/websocket.ts` 中注册新的事件：

```typescript
const eventDispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    await handleMessage(data);
  },
  'card.action.trigger': async (data) => {
    await handleCardAction(data);
  },
});
```

### 日志级别

可通过 `.env` 文件配置日志级别：
- `error`: 仅错误
- `warn`: 警告和错误
- `info`: 信息、警告和错误（默认）
- `debug`: 调试信息

## 常见问题

### 连接失败

**问题**: WebSocket 连接失败

**解决方案**:
1. 检查 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是否正确
2. 确认在飞书开放平台启用了 WebSocket 模式
3. 检查网络连接

### 收不到消息

**问题**: 机器人收不到用户消息

**解决方案**:
1. 确认在飞书开放平台订阅了 `im.message.receive_v1` 事件
2. 检查应用权限是否包含 `im:message`
3. 确认机器人已添加到测试群组

### 发送消息失败

**问题**: 机器人无法发送消息

**解决方案**:
1. 检查应用权限是否包含 `im:message:send_as_bot`
2. 确认机器人在目标群组中
3. 查看日志中的详细错误信息

## 扩展建议

### 短期扩展

- 支持更多消息类型（图片、文件、富文本）
- 流式输出完成后追加评价按钮（卡片交互回调）
- 添加消息模板

### 中期扩展

- 实现卡片消息交互
- 添加用户权限管理
- 集成数据库存储

### 长期扩展

- 多机器人管理
- 定时任务和推送
- 集成外部 API 服务
- 数据分析和统计

## 技术架构

### stdio 管道通信优势

- **简单可靠**: 标准的进程间通信方式
- **无需额外端口**: 不需要管理 WebSocket 端口
- **进程隔离**: 每个会话独立的 CLI 进程
- **官方支持**: 与 Python SDK 实现方式一致

### 代码组织原则

- **单一职责**: 每个模块只负责一个功能
- **依赖注入**: 通过导入模块实现松耦合
- **错误处理**: 统一的错误处理和日志记录
- **类型安全**: 使用 TypeScript 严格模式

## 核心协议文档

### Claude Code stdio 协议

本项目使用 Claude Code CLI 的 `--input-format stream-json` 和 `--output-format stream-json` 参数通过 stdin/stdout 管道进行 NDJSON 通信。完整的协议规范请参考：

📄 **[docs/WEBSOCKET_PROTOCOL_REVERSED.md](docs/WEBSOCKET_PROTOCOL_REVERSED.md)**

该文档详细描述了：
- NDJSON 消息格式（13 种消息类型）
- 控制协议（13 种子类型）
- 权限审批流程（`can_use_tool`）
- 会话管理和恢复
- 完整的 TypeScript 类型定义

**关键要点**：
- 协议基于 NDJSON（每行一个 JSON 对象）
- 通过 stdin 发送消息，从 stdout 接收响应
- 首条消息必须是 `user` 消息，CLI 响应 `system/init`
- 工具权限通过 `control_request/can_use_tool` 请求
- 响应必须包含 `updatedInput`（即使不修改）
- 支持会话恢复（`--resume <session-id>`）

### Python SDK 实现分析

Anthropic 官方的 Python SDK 实现提供了重要的参考价值：

📄 **[docs/PYTHON_SDK_ANALYSIS.md](docs/PYTHON_SDK_ANALYSIS.md)**

该文档分析了：
- **通信方式**：stdin/stdout 管道（而非 WebSocket）
- **两种模式**：`query()` 单次查询 vs `ClaudeSDKClient` 持续对话
- **控制协议**：与我们反向的协议完全一致
- **进程管理**：优雅的启动、关闭和错误处理
- **会话管理**：直接读取 `.jsonl` 文件，无需 CLI
- **高级功能**：中断、动态权限切换、模型切换、文件回滚

**关键发现**：
- Python SDK 使用 `--input-format stream-json` 通过 stdin/stdout 通信
- stdin/stdout 管道比 WebSocket 更简单可靠
- 协议定义在代码中（TypedDict），无独立文档
- 我们的协议文档比官方 SDK 更详细完整
- 我们的实现已从 WebSocket 迁移到 stdio 模式，与官方 SDK 一致

## 许可证

MIT

## 开发规范

### 日志规范

本项目使用 Winston 进行结构化日志记录，要求：

#### 日志级别

- **DEBUG**：详细的执行流程、函数参数、状态变化、协议消息元数据
- **INFO**：关键操作、会话生命周期、命令执行结果
- **WARN**：可恢复的异常、降级处理
- **ERROR**：错误和异常

#### 日志上下文

每条日志必须包含相关的上下文信息，方便追踪和关联：

**通用字段**：
- `module` - 模块名称（如 AgentManager、ChatSessionManager）

**Agent 相关**：
- `agentId` - agent ID
- `sessionId` - Claude session ID
- `cwd` - 工作目录
- `processId` - CLI 进程 PID

**Chat 相关**：
- `chatId` - 飞书 chat ID
- `userId` - 用户 ID（如果有）

**消息相关**：
- `messageType` - 消息类型（user/assistant/system/control_request 等）
- `messageLength` - 消息长度（字符数）
- **不记录消息实际内容**（保护隐私）

**操作相关**：
- `operation` - 操作类型（create/send/interrupt/close）
- `command` - 命令类型（new/cd/stop/status）

#### 日志示例

```typescript
// 好的日志
logger.info('[AgentManager] Creating agent', {
  agentId,
  cwd,
  resumeSessionId,
  operation: 'create'
});

logger.debug('[AgentManager] Sending message', {
  agentId,
  sessionId,
  messageLength: text.length,
  operation: 'send'
});

logger.error('[AgentManager] Failed to create agent', {
  agentId,
  cwd,
  error: error.message,
  stack: error.stack
});

// 不好的日志
logger.info('Creating agent'); // 缺少上下文
logger.debug('Message: ' + text); // 泄露消息内容
logger.error('Error: ' + error); // 缺少结构化信息
```

#### 日志目标

通过分析日志应该能够：
1. 追踪一条消息的完整流程（从接收到响应）
2. 调试 agent 创建失败的原因
3. 分析并发问题和竞态条件
4. 关联相关的操作（通过 chatId/agentId/sessionId）


## 贡献

欢迎提交 Issue 和 Pull Request。

---

🤖 本项目由 Claude Code 协助开发

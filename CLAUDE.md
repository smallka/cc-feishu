# 飞书机器人 - WebSocket 长连接

基于 TypeScript 和 Node.js 的飞书机器人，使用 WebSocket 长连接模式实现实时消息交互。

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
│   │   └── websocket.ts        # WebSocket 连接管理
│   ├── handlers/
│   │   └── message.handler.ts  # 消息事件处理
│   ├── services/
│   │   └── message.service.ts  # 消息发送服务
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

4. **发布应用**
   - 发布应用并在企业内可用

5. **添加机器人到群组**
   - 创建测试群组
   - 将机器人添加到群组

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

- ✅ WebSocket 长连接（自动重连和心跳）
- ✅ 文本消息接收
- ✅ 文本消息回复
- ✅ 结构化日志记录
- ✅ 优雅关闭（Ctrl+C）
- ✅ 错误处理和重试

### 消息处理逻辑

当前实现了简单的回显功能：
- 接收用户发送的文本消息
- 回复"你说: [用户消息]"

## 核心模块说明

### WebSocket 连接管理 (`src/bot/websocket.ts`)

负责管理 WebSocket 长连接：
- 创建 WSClient 实例
- 注册事件处理器
- 自动处理心跳和重连
- 优雅关闭连接

### 消息处理器 (`src/handlers/message.handler.ts`)

处理接收到的消息事件：
- 解析消息内容
- 根据消息类型分发处理
- 调用消息服务发送回复

### 消息服务 (`src/services/message.service.ts`)

封装消息发送 API：
- 发送文本消息
- 统一错误处理
- 日志记录

### 配置管理 (`src/config/index.ts`)

集中管理应用配置：
- 加载环境变量
- 验证必需配置
- 提供类型安全的配置访问

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
- 实现命令系统（/help, /status）
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

### WebSocket 长连接优势

- **无需公网 IP**: 不需要配置回调 URL
- **实时推送**: 事件即时到达，延迟低
- **自动重连**: SDK 内置重连机制
- **心跳保活**: 自动维持连接活跃

### 代码组织原则

- **单一职责**: 每个模块只负责一个功能
- **依赖注入**: 通过导入模块实现松耦合
- **错误处理**: 统一的错误处理和日志记录
- **类型安全**: 使用 TypeScript 严格模式

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request。

---

🤖 本项目由 Claude Code 协助开发

# 安装和配置指南

## 前置条件

- Node.js 18+
- Claude Code CLI（`claude` 命令可用且已登录）

## 安装步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxx
CLAUDE_WORK_ROOT=/path/to/your/projects
CLAUDE_MODEL=claude-opus-4-6
NODE_ENV=development
LOG_LEVEL=info
```

### 3. 飞书开放平台配置

访问 [飞书开放平台](https://open.feishu.cn)：

#### 3.1 启用机器人

- 进入应用管理
- 启用机器人功能

#### 3.2 配置事件订阅

- 进入"事件与回调"
- 选择"使用长连接接收事件/回调"（WebSocket 模式）
- 订阅 `im.message.receive_v1` 事件

#### 3.3 配置权限

添加以下权限：
- `im:message` - 接收消息
- `im:message:send_as_bot` - 发送消息

#### 3.4 发布应用

- 发布应用
- 确保在企业内可用

#### 3.5 添加机器人到群组

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

## 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `FEISHU_APP_ID` | 飞书应用 ID | 必填 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 必填 |
| `CLAUDE_WORK_ROOT` | 工作根目录 | `process.cwd()` |
| `CLAUDE_MODEL` | Claude 模型 | `claude-opus-4-6` |
| `NODE_ENV` | 运行环境 | `development` |
| `LOG_LEVEL` | 日志级别 | `info` |

## 常见问题

### WebSocket 连接失败

**检查**：
1. `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是否正确
2. 飞书开放平台是否启用了 WebSocket 模式
3. 网络连接是否正常

### 收不到消息

**检查**：
1. 是否订阅了 `im.message.receive_v1` 事件
2. 应用权限是否包含 `im:message`
3. 机器人是否已添加到测试群组

### 发送消息失败

**检查**：
1. 应用权限是否包含 `im:message:send_as_bot`
2. 机器人是否在目标群组中
3. 查看日志中的详细错误信息

### Claude Code CLI 未找到

**检查**：
1. 运行 `claude --version` 确认 CLI 已安装
2. 确认 CLI 已完成认证登录
3. 检查 PATH 环境变量

## 日志级别

通过 `LOG_LEVEL` 环境变量配置：

- `error` - 仅错误
- `warn` - 警告和错误
- `info` - 信息、警告和错误（默认）
- `debug` - 调试信息

## 验证安装

启动后应看到类似日志：

```
[Bot] Feishu WebSocket client started
[Bot] WebSocket connected
```

在飞书群组中发送消息，机器人应该响应。

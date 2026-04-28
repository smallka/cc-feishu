# 安装与配置指南

## 前置条件

- Node.js 18+
- 飞书应用已启用机器人与事件订阅
- 所需 Agent 已可用
  - 使用 Claude 时，需要本机可执行 `claude`
  - 使用 Codex 时，需要本机可执行相应的 Codex 命令

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

编辑 `.env`：

```env
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxx
AGENT_PROVIDER=claude
AGENT_WORK_ROOT=C:\work
CLAUDE_MODEL=claude-opus-4-6
SINGLE_INSTANCE_PORT=8652
NODE_ENV=development
LOG_LEVEL=info
```

说明：

- 消息处理超时策略使用内置默认值，不通过环境变量开放配置。
- 单连接启动锁的重试时长和重试间隔使用内置默认值，不通过环境变量开放配置。

### 3. 飞书开放平台配置

访问 [飞书开放平台](https://open.feishu.cn)。

#### 3.1 启用机器人

- 进入应用管理
- 启用机器人能力

#### 3.2 配置事件订阅

- 进入“事件与回调”
- 选择“使用长连接接收事件回调”（WebSocket 模式）
- 订阅 `im.message.receive_v1`

#### 3.3 配置权限

至少需要以下权限：

- `im:message`
- `im:message:send_as_bot`

#### 3.4 发布应用

- 发布应用
- 确保应用在目标企业内可用

#### 3.5 将机器人加入群聊

- 创建测试群
- 将机器人加入测试群

## 启动方式

### 开发模式

```bash
npm run dev
```

### 生产模式

```bash
npm run build
npm start
```

### 使用 PM2 托管

推荐在 Windows 常驻运行时使用项目根目录下的 `ecosystem.config.js`：

```powershell
New-Item -ItemType Directory -Force logs
npm run build
pm2 start ecosystem.config.js
pm2 save
```

常用命令：

```powershell
pm2 status
pm2 logs cc-feishu-ts
pm2 restart cc-feishu-ts
pm2 stop cc-feishu-ts
```

说明：

- `ecosystem.config.js` 已固定工作目录为项目根目录，`.env` 会按当前仓库结构自动加载。
- 默认日志会落到 `logs/pm2-out.log` 和 `logs/pm2-error.log`。
- 若在 Windows 下使用 `codex` provider，建议在 `.env` 中显式配置 `CODEX_CMD`，避免因运行用户不同导致找不到 Codex CLI。
- 若在 Windows 11 下遇到 PM2 的 `spawn wmic ENOENT`，可参考 `docs/pm2-win11-pidusage-fix.md`。

## 单连接启动锁

应用在启动时会先获取本地端口锁，再初始化 WebSocket 连接。这样可以避免同一台机器上出现多个本地进程同时持有飞书长连接。

可配置环境变量：

- `SINGLE_INSTANCE_PORT`：本地启动锁使用的 TCP 端口，默认 `8652`

固定内置参数：

- 启动锁总等待时长：`5000ms`
- 启动锁重试间隔：`300ms`

行为说明：

- 第一个进程正常启动
- 第二个进程会短暂重试
- 超过重试窗口仍未拿到锁时，第二个进程退出

Windows 示例：

```powershell
$env:SINGLE_INSTANCE_PORT="8652"
npm start
```

## 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `FEISHU_APP_ID` | 飞书应用 ID | 必填 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 必填 |
| `AGENT_PROVIDER` | Agent 类型，可选 `claude` / `codex` | `claude` |
| `AGENT_WORK_ROOT` | 默认工作目录 | 当前进程目录 |
| `CLAUDE_MODEL` | Claude 模型名 | `claude-opus-4-6` |
| `SINGLE_INSTANCE_PORT` | 本地启动锁端口 | `8652` |
| `NODE_ENV` | 运行环境 | `development` |
| `LOG_LEVEL` | 日志级别 | `info` |

## 常见问题

### WebSocket 连接失败

请检查：

1. `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是否正确
2. 飞书开放平台是否启用了 WebSocket 模式
3. 本机网络是否正常

### 第二个进程启动失败

请检查：

1. 当前机器上是否已经有一个实例在运行
2. `SINGLE_INSTANCE_PORT` 是否被其他程序占用

### 配置迁移说明

- `CLAUDE_WORK_ROOT` 已废弃，建议改用 `AGENT_WORK_ROOT`
- 当前版本仍兼容 `CLAUDE_WORK_ROOT`
- `CHAT_BINDINGS_FILE` 支持相对文件路径，按进程启动目录解析；使用 PM2 时即按 `ecosystem.config.js` 里的 `cwd` 解析

### 收不到消息

请检查：

1. 是否订阅了 `im.message.receive_v1`
2. 应用权限是否包含 `im:message`
3. 机器人是否已加入目标群聊

### 发送消息失败

请检查：

1. 应用权限是否包含 `im:message:send_as_bot`
2. 机器人是否在目标群聊中
3. 日志中是否有详细错误信息

## 验证安装

启动成功后，应能看到应用启动日志，并且在飞书群里发送消息后机器人能正常回复。

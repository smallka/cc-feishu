# 安装和配置指南

## 前置条件

- Python 3.10+
- Claude Code CLI（`claude` 命令可用且已登录）

## 安装步骤

### 1. 安装依赖

使用 pip 安装项目依赖：

```bash
# 安装生产依赖
pip install -e .

# 或安装包含开发工具的依赖
pip install -e ".[dev]"
```

### 2. 配置环境变量

复制模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 飞书配置
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxx

# Claude 配置
CLAUDE_WORK_ROOT=/path/to/your/projects
CLAUDE_MODEL=claude-opus-4-6
MESSAGE_TIMEOUT=300000

# 日志配置
LOG_LEVEL=INFO
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

开发模式：

```bash
python -m src.main
```

生产模式（使用进程管理器，见下文）：

```bash
# systemd
sudo systemctl start feishu-bot

# supervisor
sudo supervisorctl start feishu-bot
```

## 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `FEISHU_APP_ID` | 飞书应用 ID | 必填 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 必填 |
| `CLAUDE_WORK_ROOT` | 工作根目录 | 当前目录 |
| `CLAUDE_MODEL` | Claude 模型 | `claude-opus-4-6` |
| `MESSAGE_TIMEOUT` | 消息处理超时（毫秒） | `300000` |
| `LOG_LEVEL` | 日志级别 | `INFO` |

## 部署配置

### 使用 systemd（推荐）

创建服务文件 `/etc/systemd/system/feishu-bot.service`：

```ini
[Unit]
Description=Feishu Bot with Claude Code
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/cc-feishu
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
ExecStart=/usr/bin/python3 -m src.main
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable feishu-bot
sudo systemctl start feishu-bot

# 查看状态
sudo systemctl status feishu-bot

# 查看日志
sudo journalctl -u feishu-bot -f
```

### 使用 supervisor

创建配置文件 `/etc/supervisor/conf.d/feishu-bot.conf`：

```ini
[program:feishu-bot]
command=/usr/bin/python3 -m src.main
directory=/path/to/cc-feishu
user=your-user
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/var/log/feishu-bot.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=10
environment=PATH="/usr/local/bin:/usr/bin:/bin"
```

启动服务：

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start feishu-bot

# 查看状态
sudo supervisorctl status feishu-bot

# 查看日志
sudo supervisorctl tail -f feishu-bot
```

### 重启策略说明

**重要**：当 WebSocket 连接断开时，应用会主动退出（exit code 1），依赖外部进程管理器（systemd/supervisor）自动重启。这是设计行为，确保连接问题能够快速恢复。

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

### 依赖安装失败

**检查**：
1. Python 版本是否 >= 3.10
2. 是否有网络连接
3. 尝试使用国内镜像：`pip install -e . -i https://pypi.tuna.tsinghua.edu.cn/simple`

## 日志级别

通过 `LOG_LEVEL` 环境变量配置：

- `ERROR` - 仅错误
- `WARNING` - 警告和错误
- `INFO` - 信息、警告和错误（默认）
- `DEBUG` - 调试信息

## 验证安装

启动后应看到类似日志：

```
INFO - Application starting
INFO - [ChatManager] Started
INFO - [WebSocket] Connecting to Feishu WebSocket
INFO - [WebSocket] Connected successfully
```

在飞书群组中发送消息，机器人应该响应。

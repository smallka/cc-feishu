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

```bash
python -m src.main
```

启动后应看到类似日志：

```
INFO - Application starting
INFO - [ChatManager] Started
INFO - [WebSocket] Connecting to Feishu WebSocket
INFO - [WebSocket] Connected successfully
```

在飞书群组中发送消息，机器人应该响应。

## 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `FEISHU_APP_ID` | 飞书应用 ID | 必填 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 必填 |
| `CLAUDE_WORK_ROOT` | 工作根目录 | 当前目录 |
| `CLAUDE_MODEL` | Claude 模型 | `claude-opus-4-6` |
| `MESSAGE_TIMEOUT` | 消息处理超时（毫秒） | `300000` |
| `LOG_LEVEL` | 日志级别 | `INFO` |

## 日志级别

通过 `LOG_LEVEL` 环境变量配置：

- `ERROR` - 仅错误
- `WARNING` - 警告和错误
- `INFO` - 信息、警告和错误（默认）
- `DEBUG` - 调试信息

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


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

#### 手动启动

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

#### Windows 自动重启配置

**方案一：NSSM（推荐）**

1. 下载 [NSSM](https://nssm.cc/download) 并解压到 `C:\tools\nssm`

2. 安装服务：
```bash
# 使用 GUI 配置
nssm install FeishuBot

# 或使用命令行
nssm install FeishuBot "C:\Python310\python.exe" "scripts\start_service.bat"
nssm set FeishuBot AppDirectory "C:\work\cc-feishu"
nssm set FeishuBot AppStdout "C:\work\cc-feishu\logs\service.log"
nssm set FeishuBot AppStderr "C:\work\cc-feishu\logs\service_error.log"
nssm set FeishuBot AppExit Default Restart
nssm set FeishuBot AppRestartDelay 5000
```

3. 启动服务：
```bash
nssm start FeishuBot
```

**方案二：任务计划程序**

1. 打开任务计划程序：`Win + R` → `taskschd.msc`

2. 创建基本任务：
   - 名称：`FeishuBot`
   - 触发器：当计算机启动时
   - 操作：启动程序
   - 程序/脚本：`C:\work\cc-feishu\scripts\start_service.bat`
   - 起始于：`C:\work\cc-feishu`

3. 配置属性（右键任务 → 属性）：
   - 常规：☑ 不管用户是否登录都要运行
   - 设置：☑ 如果任务失败，重新启动间隔：5 分钟

**启动脚本说明**

`scripts/start_service.bat` 和 `scripts/start_service.py` 提供以下功能：
- 自动检测并关闭旧进程（避免重复启动）
- 使用互斥锁确保单实例运行
- 进程崩溃时自动重启（配合 NSSM/任务计划程序）
- 记录启动/停止日志

## 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `FEISHU_APP_ID` | 飞书应用 ID | 必填 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 必填 |
| `CLAUDE_WORK_ROOT` | 工作根目录 | 当前目录 |
| `CLAUDE_MODEL` | Claude 模型 | `claude-opus-4-6` |
| `MESSAGE_TIMEOUT` | 消息处理超时（毫秒） | `300000` |
| `LOG_LEVEL` | 日志级别 | `INFO` |

## 依赖说明

核心依赖：
- `claude-agent-sdk` - Claude Code CLI 官方 SDK
- `lark-oapi` - 飞书 Python SDK
- `python-dotenv` - 环境变量管理
- `psutil` - 进程管理（用于启动脚本去重）

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


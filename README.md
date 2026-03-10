# 飞书机器人 - Claude Code 交互

基于 Python 的飞书机器人，通过 WebSocket 接收消息，通过 stdin/stdout 管道与 Claude Code CLI 通信。

## 特性

- **会话持久化** - 每个飞书聊天对应独立的 Claude 会话，重启后自动恢复上下文
- **工作目录管理** - 支持切换工作目录，在不同项目间自由切换
- **多聊天支持** - 多个飞书聊天可同时使用，互不干扰
- **自动重启** - WebSocket 断开时自动退出，依赖进程管理器重启

## 技术栈

- Python 3.10+
- `claude-agent-sdk` - Claude Code CLI 官方 SDK
- `lark-oapi` - 飞书 Python SDK
- `asyncio` - 异步框架

## 快速开始

```bash
# 1. 安装依赖
pip install -e .

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入飞书凭证和工作目录

# 3. 启动
python -m src.main
```

详细安装配置步骤见 [INSTALL.md](INSTALL.md)。

## 使用说明

### 可用命令

在飞书聊天中可以使用以下命令：

- `/help` - 显示命令列表
- `/new` - 重置会话，创建新的对话
- `/stop` - 中断当前正在执行的任务
- `/stat` - 查看当前会话状态（session ID、工作目录）
- `/cd [路径]` - 切换工作目录
- `/debug` - 显示系统状态（Agent 数量、内存使用等）

### 工作流程

1. **首次对话** - 在默认工作目录创建新会话
2. **后续对话** - 自动恢复之前的会话上下文
3. **切换项目** - 使用 `/cd` 切换到其他项目目录
4. **重置会话** - 使用 `/new` 清空上下文，开始新对话

## 项目结构

```
src/
├── main.py                     # 入口
├── config/                     # 配置管理
├── bot/
│   ├── client.py              # 飞书客户端
│   ├── websocket.py           # WebSocket 连接
│   └── chat_manager.py        # 会话管理
├── claude/
│   └── agent.py               # Agent 封装
├── handlers/
│   └── message_handler.py     # 消息处理
├── services/
│   └── message_service.py     # 消息发送
└── utils/
    └── logger.py              # 日志配置
```

## 技术架构

```
用户消息 → 飞书 WebSocket → ChatManager → Claude Agent → Claude Code CLI
                                                              ↓
用户收到回复 ← 飞书 API ← MessageService ← 回调处理 ← SDK 输出解析
```

核心组件：
- **ChatManager** - 管理聊天与 Agent 的映射关系
- **Agent** - 封装单个 Claude Code CLI 进程
- **ClaudeSDKClient** - 官方 SDK，处理 stdio 通信

## 文档

- [INSTALL.md](INSTALL.md) - 安装配置指南（飞书配置、部署方案）
- [CLAUDE.md](CLAUDE.md) - 开发指南（架构设计、开发规范）
- [docs/PROTOCOL_SPEC.md](docs/PROTOCOL_SPEC.md) - Claude Code 协议规范

## 许可证

MIT

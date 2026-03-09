# 飞书机器人 Python 迁移设计文档

## 概述

将现有 TypeScript 实现的飞书机器人迁移到 Python，保持核心架构不变，使用官方 Python SDK 简化 Claude Code CLI 通信层。

## 迁移动机

- **更适合 AI 编辑和维护**：Python 代码结构更简洁，AI 更容易理解和修改
- **减少代码量**：使用 `claude-agent-sdk` 替代自己实现的协议层，预计减少 40-50% 代码
- **官方维护**：SDK 由官方维护，协议更新自动跟进

## 设计原则

**简单 + 兜底 + 提示**

1. **简单**：优先选择简单方案，避免过度设计
2. **兜底**：提供可靠的兜底机制（`/new` 命令永远可用）
3. **提示**：所有异常都有明确的用户提示

## 核心架构

### 保持不变的架构

```
ChatManager (管理 Chat → Agent 映射)
    ↓
Agent (封装单个 Claude Code CLI 会话)
    ↓
ClaudeSDKClient (官方 SDK，替代 CLIBridge + CLILauncher)
```

**关键关系**：
- 一个 Chat 对应一个 ChatData（持久化元数据：cwd, session_id）
- 一个 Chat 同一时间最多一个 Agent（进程实例）
- Agent 内部使用 `ClaudeSDKClient` 管理 CLI 进程

### 删除的模块

- `src/claude/launcher.ts` - 被 SDK 封装替代
- `src/claude/bridge.ts` - 被 SDK 封装替代
- `src/claude/types.ts` - 使用 SDK 提供的类型
- `src/claude/session-scanner.ts` - 功能很少使用，删除

## 技术栈选型

| 功能 | TypeScript | Python |
|------|-----------|--------|
| Claude CLI 通信 | 自己实现 | `claude-agent-sdk` |
| 飞书 SDK | `@larksuiteoapi/node-sdk` | `lark-oapi` |
| 异步框架 | Node.js 原生 | `asyncio` |
| 日志 | `winston` | 标准库 `logging` |
| 环境变量 | `dotenv` | `python-dotenv` |
| 类型检查 | TypeScript | `mypy` + type hints |

## 详细设计

### 1. Agent 类

**职责**：封装单个 Claude Code CLI 会话

```python
class Agent:
    def __init__(self, chat_id: str, cwd: str, resume_session_id: str | None):
        self.agent_id = f"agent{next_id()}"
        self.chat_id = chat_id
        self.cwd = cwd
        self.session_id = resume_session_id
        self.start_time = time.time()
        self._connected = False

        # 创建 SDK 客户端
        options = ClaudeAgentOptions(
            cwd=cwd,
            resume_session_id=resume_session_id,
            permission_mode='bypassPermissions',
            model=config.claude.model,
        )
        self.client = ClaudeSDKClient(options=options)

    async def ensure_connected(self):
        """确保已连接（懒加载）"""
        if not self._connected:
            try:
                await asyncio.wait_for(
                    self.client.connect(),
                    timeout=10.0
                )
                self._connected = True
            except asyncio.TimeoutError:
                raise ConnectionError('连接 Claude CLI 超时')
            except Exception as e:
                raise ConnectionError(f'连接 Claude CLI 失败: {e}')

    async def destroy(self):
        """销毁 Agent（尽力优雅关闭）"""
        logger.info('Destroying agent', agent_id=self.agent_id)
        try:
            await self.client.disconnect()
        except Exception as e:
            logger.error('Error disconnecting client', error=e)
```

**关键点**：
- 使用 `ClaudeSDKClient` 替代 `CLIBridge + CLILauncher`
- 懒加载连接（首次发送消息时连接）
- `session_id` 从 `ResultMessage` 中提取并缓存

---

### 2. ChatManager 类

**职责**：管理多个 Chat 的 Agent 实例

```python
class ChatManager:
    def __init__(self):
        self.chats: dict[str, ChatData] = {}  # chat_id -> {cwd, session_id}
        self.agents: dict[str, Agent] = {}    # chat_id -> Agent
        self.default_cwd = config.claude.work_root
        self.start_time = time.time()

    async def send_message(self, chat_id: str, text: str):
        """发送消息并等待响应（会阻塞）"""
        agent = self.get_or_create_agent(chat_id)

        try:
            await agent.ensure_connected()
            await agent.client.query(text)

            collected_text = []
            async for msg in agent.client.receive_response():
                if isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if isinstance(block, TextBlock):
                            collected_text.append(block.text)

                elif isinstance(msg, ResultMessage):
                    # 更新 session_id
                    agent.session_id = msg.session_id
                    self.chats[chat_id]['session_id'] = msg.session_id

                    # 发送完整响应
                    full_text = ''.join(collected_text)
                    await self._send_response(chat_id, full_text)
                    break

        except ConnectionError as e:
            await self._send_response(chat_id, f'❌ {e}\n提示：使用 /new 重置会话')
            raise

        except asyncio.CancelledError:
            logger.info('Message processing cancelled', chat_id=chat_id)
            raise

        except Exception as e:
            logger.error('Error in send_message', chat_id=chat_id, error=e)
            raise

    async def interrupt(self, chat_id: str) -> str:
        """尝试中断当前任务"""
        agent = self.agents.get(chat_id)
        if not agent:
            return 'no_session'

        try:
            await asyncio.wait_for(agent.client.interrupt(), timeout=3.0)
            return 'success'
        except asyncio.TimeoutError:
            logger.warn('Interrupt timeout', chat_id=chat_id)
            return 'timeout'
        except Exception as e:
            logger.error('Interrupt failed', chat_id=chat_id, error=e)
            return 'error'

    async def reset(self, chat_id: str) -> str:
        """重置会话（强制清理）"""
        agent = self.agents.get(chat_id)

        if agent:
            try:
                await asyncio.wait_for(agent.destroy(), timeout=2.0)
            except asyncio.TimeoutError:
                logger.warn('Agent destroy timeout', chat_id=chat_id)
            except Exception as e:
                logger.error('Error destroying agent', chat_id=chat_id, error=e)

            # 强制清理
            self.agents.pop(chat_id, None)

        # 保留 cwd，清空 session_id
        cwd = self.chats.get(chat_id, {}).get('cwd', self.default_cwd)
        self.chats[chat_id] = {'cwd': cwd, 'session_id': None}

        logger.info('Session reset', chat_id=chat_id)
        return cwd

    async def switch_cwd(self, chat_id: str, new_cwd: str):
        """切换工作目录（强制清理 Agent）"""
        current_cwd = self.chats.get(chat_id, {}).get('cwd', self.default_cwd)
        if current_cwd == new_cwd:
            return

        agent = self.agents.get(chat_id)
        if agent:
            try:
                await asyncio.wait_for(agent.destroy(), timeout=2.0)
            except asyncio.TimeoutError:
                logger.warn('Agent destroy timeout when switching cwd', chat_id=chat_id)
            except Exception as e:
                logger.error('Error destroying agent when switching cwd', chat_id=chat_id, error=e)

            self.agents.pop(chat_id, None)

        self.chats[chat_id] = {'cwd': new_cwd, 'session_id': None}
        logger.info('Switched cwd', chat_id=chat_id, new_cwd=new_cwd)

    def get_or_create_agent(self, chat_id: str) -> Agent:
        """获取或创建 Agent"""
        agent = self.agents.get(chat_id)

        if agent and agent.client:
            return agent
        elif agent:
            # Agent 已损坏，清理
            logger.warn('Agent damaged, cleaning up', chat_id=chat_id)
            self.agents.pop(chat_id, None)

        # 创建新 Agent
        cwd = self.chats.get(chat_id, {}).get('cwd', self.default_cwd)
        session_id = self.chats.get(chat_id, {}).get('session_id')

        try:
            agent = Agent(chat_id, cwd, session_id)
            self.agents[chat_id] = agent
            return agent
        except Exception as e:
            logger.error('Failed to create agent', chat_id=chat_id, error=e)
            raise RuntimeError(f'创建 Agent 失败: {e}')
```

**关键点**：
- 使用 `async for msg in client.receive_response()` 接收消息
- 超时保护在外层 `message_handler` 中用 `asyncio.wait_for()` 实现
- `/new` 命令强制清理，永远可用（兜底机制）

---

### 3. 消息处理器

```python
async def handle_message_internal(data: MessageEvent, start_time: float):
    """内部消息处理逻辑"""
    message = data['message']
    chat_id = message['chat_id']
    text = extract_text(message)

    # 命令处理
    if text == '/stop':
        result = await chat_manager.interrupt(chat_id)

        if result == 'success':
            await message_service.send_text_message(
                chat_id, '⏸️ 已发送中断信号，AI 将停止当前任务'
            )
        elif result == 'timeout':
            await message_service.send_text_message(
                chat_id, '⚠️ 中断信号发送超时，请使用 /new 强制重置会话'
            )
        elif result == 'no_session':
            await message_service.send_text_message(
                chat_id, '❌ 当前没有活跃的会话'
            )
        else:
            await message_service.send_text_message(
                chat_id, '⚠️ 中断失败，请使用 /new 强制重置会话'
            )
        return

    if text == '/new':
        cwd = await chat_manager.reset(chat_id)
        await message_service.send_text_message(
            chat_id, f'✅ 会话已重置，可以开始新的对话\n工作目录: {cwd}'
        )
        return

    # 其他命令处理...

    # 转发给 Claude
    reaction_id = await message_service.add_reaction(
        message['message_id'], 'Typing'
    )

    try:
        await chat_manager.send_message(chat_id, text)

    except asyncio.CancelledError:
        await message_service.send_text_message(
            chat_id, '⚠️ 处理被中断\n提示：使用 /new 可以重置会话'
        )
        raise

    except RuntimeError as e:
        await message_service.send_text_message(
            chat_id, f'❌ {e}\n提示：使用 /new 可以重置会话'
        )

    except Exception as e:
        logger.error('Error sending message', chat_id=chat_id, error=e)
        await message_service.send_text_message(
            chat_id, f'❌ 处理消息时出错: {str(e)}\n提示：使用 /new 可以重置会话'
        )

    finally:
        if reaction_id:
            try:
                await message_service.remove_reaction(
                    message['message_id'], reaction_id
                )
            except Exception as e:
                logger.warn('Failed to remove reaction', error=e)


async def handle_message(data: MessageEvent):
    """外层超时保护"""
    start_time = time.time()
    message = data['message']

    # 消息去重
    if is_duplicate(message['message_id']):
        logger.debug('Skipping duplicate message', message_id=message['message_id'])
        return

    try:
        await asyncio.wait_for(
            handle_message_internal(data, start_time),
            timeout=config.claude.message_timeout / 1000
        )

    except asyncio.TimeoutError:
        duration = time.time() - start_time
        logger.error('Message processing timeout',
                    message_id=message['message_id'],
                    chat_id=message['chat_id'],
                    duration=duration)

        await message_service.send_text_message(
            message['chat_id'],
            f'⚠️ 消息处理超时（{config.claude.message_timeout // 1000}秒）\n'
            f'提示：使用 /new 重置会话'
        )

    except Exception as e:
        logger.error('Unexpected error in handle_message',
                    message_id=message['message_id'], error=e)
```

**关键点**：
- 使用 `try/finally` 保证表情清理（去掉队列机制）
- 超时用 `asyncio.wait_for()` 实现
- 所有异常都有用户提示

---

### 4. 飞书 WebSocket 连接

```python
class WebSocketManager:
    def __init__(self):
        self.ws_client = None

    async def start(self):
        """启动 WebSocket 连接（阻塞到断开）"""
        try:
            self.ws_client = lark.ws.Client(
                app_id=config.feishu.app_id,
                app_secret=config.feishu.app_secret,
            )

            # 注册消息处理器
            self.ws_client.register_handler(
                'im.message.receive_v1',
                MessageReceiveV1Handler(handle_message)
            )

            logger.info('Starting WebSocket connection')
            await self.ws_client.start()

            # 如果 start() 返回，说明连接断开
            logger.error('WebSocket connection closed unexpectedly')
            raise ConnectionError('WebSocket 连接已断开')

        except Exception as e:
            logger.error('WebSocket error', error=e)
            raise

    async def stop(self):
        """停止 WebSocket 连接"""
        if self.ws_client:
            try:
                await asyncio.wait_for(self.ws_client.stop(), timeout=5.0)
                logger.info('WebSocket stopped')
            except asyncio.TimeoutError:
                logger.warn('WebSocket stop timeout')
            except Exception as e:
                logger.error('Error stopping WebSocket', error=e)

            self.ws_client = None
```

**关键点**：
- **不实现自动重连**
- WebSocket 断开 → 进程退出
- 依赖外部进程管理器（systemd/supervisor）自动重启

---

### 5. 主入口

```python
async def main():
    """主入口"""
    try:
        await chat_manager.start()

        # WebSocket 启动（会阻塞到断开）
        await websocket_manager.start()

        # 如果执行到这里，说明 WebSocket 断开了
        logger.error('WebSocket disconnected, exiting')
        sys.exit(1)

    except KeyboardInterrupt:
        logger.info('Received shutdown signal')
    except Exception as e:
        logger.error('Fatal error', error=e)
        sys.exit(1)
    finally:
        await chat_manager.stop()
        await websocket_manager.stop()


if __name__ == '__main__':
    asyncio.run(main())
```

---

## 异步模式设计

### 核心模式：`async for` + `asyncio.wait_for()`

**消息接收**：
```python
async for msg in agent.client.receive_response():
    # 处理消息
```

**超时保护**：
```python
await asyncio.wait_for(task, timeout=300.0)
```

**中断处理**：
```python
await agent.client.interrupt()  # SDK 提供的中断方法
```

### 与 TypeScript 的差异

| 功能 | TypeScript | Python |
|------|-----------|--------|
| 超时 | `Promise.race()` | `asyncio.wait_for()` |
| 定时器 | `setTimeout()` | `asyncio.sleep()` |
| 并发 | `Promise.all()` | `asyncio.gather()` |
| 回调 | 事件驱动 | `async for` 迭代器 |

---

## 兜底机制

### 用户可用的兜底指令

| 指令 | 效果 | 使用场景 |
|------|------|---------|
| `/stop` | 尝试中断（3秒超时） | AI 正在执行任务，想停止 |
| `/new` | 强制重置会话（2秒超时 + 强制清理） | **任何卡死、异常情况** |
| `/cd [路径]` | 切换目录（会销毁 Agent） | 想换工作目录 |

### 异常提示

| 异常 | 提示内容 |
|------|---------|
| 超时 | `⚠️ 消息处理超时（300秒）\n提示：使用 /new 重置会话` |
| 中断超时 | `⚠️ 中断信号发送超时，请使用 /new 强制重置会话` |
| 中断失败 | `⚠️ 中断失败，请使用 /new 强制重置会话` |
| 连接失败 | `❌ 连接 Claude CLI 失败: {error}\n提示：使用 /new 重置会话` |
| 创建失败 | `❌ 创建 Agent 失败: {error}\n提示：使用 /new 重置会话` |
| 处理异常 | `❌ 处理消息时出错: {error}\n提示：使用 /new 可以重置会话` |

### 核心保证

1. **`/new` 永远可用**：即使 Agent 卡死，也能强制清理
2. **超时不自动重置**：让用户决定是重试还是重置
3. **所有异常都有提示**：告诉用户发生了什么，如何解决

---

## 项目结构

```
src/
├── main.py                     # 入口
├── config/
│   └── __init__.py            # 配置
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
    └── logger.py              # 日志
```

---

## 部署方案

### 推荐：systemd（Linux）

```ini
[Unit]
Description=Feishu Bot
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/project
ExecStart=/usr/bin/python3 -m src.main
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**效果**：
- WebSocket 断开 → 进程退出 → systemd 自动重启（10秒后）
- 简单可靠，不需要自己实现重连逻辑

---

## 迁移步骤

1. **搭建 Python 项目骨架**
   - 创建目录结构
   - 配置 `pyproject.toml`
   - 安装依赖

2. **实现核心模块**
   - `config` - 配置加载
   - `logger` - 日志系统
   - `Agent` - CLI 封装
   - `ChatManager` - 会话管理

3. **实现飞书集成**
   - `client` - 飞书客户端
   - `websocket` - WebSocket 连接
   - `message_service` - 消息发送
   - `message_handler` - 消息处理

4. **测试验证**
   - 单元测试
   - 集成测试
   - 功能对比测试

5. **部署上线**
   - 配置 systemd
   - 监控日志
   - 灰度切换

---

## 成功标准

1. **功能完全对齐**：所有命令和特性都能正常工作
2. **代码可维护性**：代码结构清晰，易于 AI 理解和修改
3. **稳定性**：异常处理完善，兜底机制可靠

---

## 风险和缓解

| 风险 | 缓解措施 |
|------|---------|
| Python SDK API 不熟悉 | 参考官方示例和文档 |
| 飞书 Python SDK 功能差异 | 提前验证关键 API |
| 异步模式差异导致 bug | 充分测试超时、中断等场景 |
| 性能下降 | 监控响应时间，必要时优化 |

---

## 附录

### 依赖清单

```toml
[project]
dependencies = [
    "claude-agent-sdk>=0.1.0",
    "lark-oapi>=1.0.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "mypy>=1.0.0",
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
]
```

### 环境变量

```bash
# 飞书配置
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret

# Claude 配置
CLAUDE_WORK_ROOT=/path/to/work
CLAUDE_MODEL=claude-opus-4-6
MESSAGE_TIMEOUT=300000  # 毫秒

# 日志配置
LOG_LEVEL=INFO
```

---

## 总结

本设计遵循"简单 + 兜底 + 提示"原则：

- **简单**：使用官方 SDK，避免重复造轮子；不实现自动重连，依赖外部进程管理
- **兜底**：`/new` 命令永远可用，强制清理所有状态
- **提示**：所有异常都有明确的用户提示，告知如何解决

迁移后代码量减少 40-50%，维护成本更低，更适合 AI 编辑和维护。

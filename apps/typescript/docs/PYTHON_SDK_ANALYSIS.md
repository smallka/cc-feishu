# Claude Agent SDK Python 版本实现分析

## 概述

本文档分析 Anthropic 官方的 [Claude Agent SDK Python 版本](https://github.com/anthropics/claude-agent-sdk-python) 的实现原理，作为我们 TypeScript 实现（cc-feishu）的参考。

**分析时间**：2026-03-07
**SDK 版本**：v0.1.43
**本地路径**：`c:\work\claude-agent-sdk-python`

---

## 核心架构

Python SDK 采用**三层架构**：

```
用户代码
    ↓
query() / ClaudeSDKClient (公开 API 层)
    ↓
InternalClient + Query (控制协议层)
    ↓
SubprocessCLITransport (进程通信层)
    ↓
Claude Code CLI 子进程 (stdin/stdout)
```

### 两种使用模式

Python SDK 提供两种 API 模式：

#### 1. `query()` - 单次查询模式

**适用场景**：
- 简单的一次性问题
- 批处理独立任务
- 自动化脚本
- 所有输入已知的场景

**特点**：
- 无状态，每次调用独立
- 单向通信（发送所有输入 → 接收所有输出）
- 不支持中断
- 不支持动态发送后续消息

**示例**：
```python
async for message in query(prompt="What is 2+2?"):
    print(message)
```

#### 2. `ClaudeSDKClient` - 持续对话模式（重点）

**适用场景**：
- 交互式对话应用
- 聊天机器人
- 需要根据响应发送后续消息
- 需要中断能力
- 长时间会话

**特点**：
- 有状态，维护对话上下文
- 双向通信，可随时发送消息
- 支持中断（`interrupt()`）
- 支持动态权限模式切换（`set_permission_mode()`）
- 支持动态模型切换（`set_model()`）
- 支持文件回滚（`rewind_files()`）

**核心 API**：
```python
async with ClaudeSDKClient(options) as client:
    # 发送消息
    await client.query("第一个问题")

    # 接收响应
    async for msg in client.receive_response():
        print(msg)

    # 继续对话
    await client.query("后续问题")
    async for msg in client.receive_response():
        print(msg)

    # 中断当前任务
    await client.interrupt()

    # 动态切换权限模式
    await client.set_permission_mode('acceptEdits')
```

**与我们的实现对比**：

| 维度 | Python SDK ClaudeSDKClient | cc-feishu SessionManager |
|------|---------------------------|-------------------------|
| **会话管理** | 单个 client 实例 = 单个会话 | chat + cwd → session 映射 |
| **连接生命周期** | connect() → disconnect() | 自动创建/复用 |
| **消息发送** | `client.query(prompt)` | 通过 bridge 发送 |
| **消息接收** | `client.receive_response()` | 回调函数 |
| **中断支持** | ✅ `client.interrupt()` | ❌ 未实现 |
| **权限切换** | ✅ `client.set_permission_mode()` | ❌ 未实现 |
| **模型切换** | ✅ `client.set_model()` | ❌ 未实现 |

---

## ClaudeSDKClient 持续对话模式详解

### 连接管理

文件：`src/claude_agent_sdk/client.py:94-185`

```python
async def connect(self, prompt: str | AsyncIterable[dict[str, Any]] | None = None):
    """Connect to Claude with a prompt or message stream."""

    # 如果没有提供 prompt，创建空的异步迭代器保持连接
    async def _empty_stream():
        return
        yield {}  # 永远不会执行，但标记为 async generator

    actual_prompt = _empty_stream() if prompt is None else prompt

    # 创建 Transport（stdin/stdout 管道）
    self._transport = SubprocessCLITransport(
        prompt=actual_prompt,
        options=options,
    )
    await self._transport.connect()

    # 创建 Query 处理控制协议
    self._query = Query(
        transport=self._transport,
        is_streaming_mode=True,  # 总是流式模式
        can_use_tool=self.options.can_use_tool,
        hooks=...,
        sdk_mcp_servers=...,
        agents=agents_dict,
    )

    # 启动消息读取和初始化
    await self._query.start()
    await self._query.initialize()
```

**关键点**：
- `connect()` 可以不传 prompt，保持连接打开
- 内部总是使用流式模式
- 一个 client 实例 = 一个 CLI 进程 = 一个会话

### 发送消息

文件：`src/claude_agent_sdk/client.py:198-227`

```python
async def query(self, prompt: str | AsyncIterable[dict[str, Any]], session_id: str = "default"):
    """Send a new request in streaming mode."""

    if isinstance(prompt, str):
        # 字符串 prompt：构造 user 消息
        message = {
            "type": "user",
            "message": {"role": "user", "content": prompt},
            "parent_tool_use_id": None,
            "session_id": session_id,
        }
        await self._transport.write(json.dumps(message) + "\n")
    else:
        # AsyncIterable：流式发送多条消息
        async for msg in prompt:
            if "session_id" not in msg:
                msg["session_id"] = session_id
            await self._transport.write(json.dumps(msg) + "\n")
```

**关键点**：
- 直接写入 stdin，不需要等待响应
- 支持单条消息或流式多条消息
- session_id 参数用于标识对话（但实际上一个 client = 一个 session）

### 接收消息

文件：`src/claude_agent_sdk/client.py:186-196, 465-483`

```python
async def receive_messages(self) -> AsyncIterator[Message]:
    """Receive all messages from Claude."""
    async for data in self._query.receive_messages():
        message = parse_message(data)
        if message is not None:
            yield message

async def receive_response(self) -> AsyncIterator[Message]:
    """Receive messages until ResultMessage (end of response)."""
    async for message in self.receive_messages():
        yield message
        if isinstance(message, ResultMessage):
            return  # 遇到 result 消息就停止
```

**两种接收方式**：
1. `receive_messages()` - 持续接收所有消息
2. `receive_response()` - 接收到 ResultMessage 就停止（一次完整响应）

### 高级功能

#### 1. 中断任务

```python
async def interrupt(self):
    """Send interrupt signal."""
    await self._query.interrupt()
```

发送 `control_request/interrupt` 消息给 CLI。

#### 2. 动态切换权限模式

```python
async def set_permission_mode(self, mode: str):
    """Change permission mode during conversation."""
    await self._query.set_permission_mode(mode)
```

发送 `control_request/set_permission_mode` 消息。

#### 3. 动态切换模型

```python
async def set_model(self, model: str | None):
    """Change AI model during conversation."""
    await self._query.set_model(model)
```

#### 4. 文件回滚

```python
async def rewind_files(self, user_message_id: str):
    """Rewind tracked files to their state at a specific user message."""
    await self._query.rewind_files(user_message_id)
```

需要启用 `enable_file_checkpointing=True`。

### 使用示例

文件：`examples/streaming_mode.py`

#### 基础对话

```python
async with ClaudeSDKClient() as client:
    # 发送第一个问题
    await client.query("What is 2+2?")

    # 接收完整响应
    async for msg in client.receive_response():
        if isinstance(msg, AssistantMessage):
            for block in msg.content:
                if isinstance(block, TextBlock):
                    print(f"Claude: {block.text}")
```

#### 多轮对话

```python
async with ClaudeSDKClient() as client:
    # 第一轮
    await client.query("What's the capital of France?")
    async for msg in client.receive_response():
        display_message(msg)

    # 第二轮
    await client.query("What's its population?")
    async for msg in client.receive_response():
        display_message(msg)
```

#### 中断和恢复

```python
async with ClaudeSDKClient() as client:
    await client.query("Count to 1000")

    # 接收部分消息后中断
    count = 0
    async for msg in client.receive_messages():
        count += 1
        if count > 5:
            await client.interrupt()
            break

    # 发送新任务
    await client.query("What is 2+2?")
    async for msg in client.receive_response():
        display_message(msg)
```

#### 动态权限切换

```python
async with ClaudeSDKClient() as client:
    # 开始时使用默认权限
    await client.query("Help me analyze this codebase")
    async for msg in client.receive_response():
        display_message(msg)

    # 切换到自动批准编辑
    await client.set_permission_mode('acceptEdits')
    await client.query("Now implement the fix we discussed")
    async for msg in client.receive_response():
        display_message(msg)
```

### 与我们实现的对比

**Python SDK ClaudeSDKClient**：
- ✅ 一个 client 实例管理一个完整会话
- ✅ 显式的 connect/disconnect 生命周期
- ✅ 支持中断、权限切换、模型切换等高级功能
- ✅ 清晰的消息接收模式（receive_response vs receive_messages）

**cc-feishu SessionManager**：
- ✅ 自动管理多个 chat 的会话映射
- ✅ 支持工作目录切换（每个目录独立 session）
- ❌ 缺少中断功能
- ❌ 缺少动态权限/模型切换
- ❌ 消息接收通过回调，不够灵活

---

## 关键发现

### 1. 通信方式：stdin/stdout，而非 WebSocket

**这是与我们实现的最大架构差异！**

#### Python SDK 实现

文件：`src/claude_agent_sdk/_internal/transport/subprocess_cli.py:378-386`

```python
self._process = await anyio.open_process(
    cmd,                    # ['claude', '--input-format', 'stream-json', ...]
    stdin=PIPE,             # 标准输入管道
    stdout=PIPE,            # 标准输出管道
    stderr=stderr_dest,     # 标准错误管道
    cwd=self._cwd,
    env=process_env,
)
```

**启动命令**：
```bash
claude --input-format stream-json [其他参数]
```

- **不使用** `--sdk-url` 参数
- 直接通过 **stdin/stdout 管道**进行 NDJSON 通信
- stderr 用于日志输出和错误信息

#### 我们的 TypeScript 实现

文件：`src/claude/launcher.ts`

```typescript
spawn('claude', ['--sdk-url', `ws://localhost:${port}/ws/cli/${sessionId}`])
```

- 使用 WebSocket 连接
- 需要额外的 WebSocket 服务器（`ws-server.ts`）
- 更复杂的连接管理和路由

#### 对比

| 维度 | Python SDK | cc-feishu (我们的实现) |
|------|-----------|---------------------|
| **启动命令** | `claude --input-format stream-json` | `claude --sdk-url ws://...` |
| **通信方式** | stdin/stdout 管道 | WebSocket |
| **协议** | NDJSON (通过管道) | NDJSON (通过 WebSocket) |
| **架构复杂度** | 简单，直接管道通信 | 复杂，需要 WebSocket 服务器 |
| **进程管理** | `anyio.open_process` | `spawn` + 平台差异处理 |
| **消息路由** | 单进程内存通道 | 跨进程 WebSocket 路由 |
| **错误处理** | 监听 stderr 流 | 依赖 WebSocket 错误事件 |
| **平台兼容** | anyio 统一抽象 | 需要处理 Windows/Linux 差异 |

---

### 2. 流式模式是默认行为

文件：`src/claude_agent_sdk/_internal/client.py:103-106`

```python
query = Query(
    transport=chosen_transport,
    is_streaming_mode=True,  # 总是使用流式模式
    ...
)
```

**关键点**：
- 内部**总是使用流式模式**
- 即使用户传入字符串 prompt，也会转换为流式消息
- 这样可以通过 `initialize` 请求发送 agents 配置

**我们的实现**：需要手动管理流式/非流式模式

---

### 3. 控制协议处理

文件：`src/claude_agent_sdk/_internal/query.py`

`Query` 类负责：

- **双向通信管理**：使用 `anyio.create_memory_object_stream` 分离控制消息和普通消息
- **权限审批**：`can_use_tool` 回调处理 `control_request/can_use_tool`
- **Hook 回调**：支持多种 hook 事件（pre_tool_use, post_tool_use 等）
- **MCP 服务器集成**：SDK 内置 MCP 服务器支持

#### 权限审批实现

```python
async def _handle_control_request(self, request: SDKControlRequest):
    """Handle control requests from CLI."""

    if request["subtype"] == "can_use_tool":
        # 这就是我们反向出来的 control_request/can_use_tool 协议！
        perm_req: SDKControlPermissionRequest = request

        result = await self._can_use_tool(
            perm_req["tool_name"],
            perm_req["tool_input"],
            ToolPermissionContext(
                tool_name=perm_req["tool_name"],
                tool_input=perm_req["tool_input"],
                ...
            ),
        )

        # 构造 control_response
        response: SDKControlResponse = {
            "type": "control_response",
            "request_id": request["request_id"],
            "result": result,  # PermissionResultAllow 或 PermissionResultDeny
        }

        # 通过 stdin 发送响应
        await self.transport.write(json.dumps(response) + "\n")
```

#### 消息路由

```python
async def _read_messages(self):
    """Read and route messages from transport."""
    async for line in self.transport.read():
        data = json.loads(line)
        msg_type = data.get("type")

        if msg_type == "control_request":
            # 路由到控制请求处理器
            await self._handle_control_request(data)
        elif msg_type == "hook_callback_request":
            # Hook 回调请求
            await self._handle_hook_callback_request(data)
        else:
            # 普通消息：system/assistant/result/user
            await self._message_send.send(data)
```

---

### 4. 进程管理

文件：`src/claude_agent_sdk/_internal/transport/subprocess_cli.py`

#### CLI 查找策略

```python
def _find_cli(self) -> str:
    """Find Claude Code CLI binary."""
    # 1. 优先使用打包的 bundled CLI
    bundled_cli = self._find_bundled_cli()
    if bundled_cli:
        return bundled_cli

    # 2. 搜索系统路径
    if cli := shutil.which("claude"):
        return cli

    # 3. 检查常见安装位置
    locations = [
        Path.home() / ".npm-global/bin/claude",
        Path("/usr/local/bin/claude"),
        Path.home() / ".local/bin/claude",
        ...
    ]
```

#### 环境变量清理

```python
process_env = {
    **os.environ,
    **self._options.env,
    "CLAUDE_CODE_ENTRYPOINT": "sdk-py",
    "CLAUDE_AGENT_SDK_VERSION": __version__,
}
# 清除 CLAUDECODE 防止嵌套检测
```

#### 版本检查

```python
MINIMUM_CLAUDE_CODE_VERSION = "2.0.0"

async def _check_claude_version(self):
    """Check Claude Code version and warn if unsupported."""
    # 运行 claude --version
    # 解析版本号
    # 如果 < 2.0.0，打印警告
```

#### 优雅关闭

```python
async def close(self):
    """Close transport and terminate process."""
    # 1. 发送 end 消息
    await self.write('{"type": "end"}\n')

    # 2. 等待进程退出（超时 5 秒）
    with anyio.move_on_after(5):
        await self._process.wait()

    # 3. 超时则强制终止
    if self._process.returncode is None:
        self._process.terminate()
        await self._process.wait()
```

---

### 5. 会话管理

文件：`src/claude_agent_sdk/_internal/sessions.py`

**关键特性**：
- 直接读取 `~/.claude/projects/<sanitized-cwd>/` 下的 `.jsonl` 文件
- **不需要运行 CLI 进程**
- 支持分页和过滤

```python
def list_sessions(directory: str | None = None) -> list[SDKSessionInfo]:
    """List all sessions in a directory."""
    # 1. 计算 sanitized 目录名
    # 2. 扫描 .jsonl 文件
    # 3. 读取文件头尾提取元数据
    # 4. 返回会话列表

def get_session_messages(
    session_id: str,
    directory: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[SessionMessage]:
    """Read messages from a session transcript."""
    # 1. 读取 .jsonl 文件
    # 2. 解析 NDJSON
    # 3. 构建对话链
    # 4. 过滤可见消息
    # 5. 应用分页
```

**我们的实现**：通过 CLI 的 `--resume` 参数恢复会话

---

## 协议验证

### Python SDK 完全使用了我们反向出来的协议

文件：`src/claude_agent_sdk/types.py:1047-1145`

```python
# SDK Control Protocol
class SDKControlRequest(TypedDict):
    type: Literal["control_request"]
    request_id: str
    request: (
        SDKControlInterruptRequest
        | SDKControlPermissionRequest
        | SDKControlInitializeRequest
        | SDKControlSetPermissionModeRequest
        | SDKHookCallbackRequest
        | SDKControlMcpMessageRequest
        | SDKControlRewindFilesRequest
        | SDKControlMcpReconnectRequest
        | SDKControlMcpToggleRequest
        | SDKControlStopTaskRequest
    )

class SDKControlResponse(TypedDict):
    type: Literal["control_response"]
    response: ControlResponse | ControlErrorResponse
```

### 支持的协议类型

与我们的 [WEBSOCKET_PROTOCOL_REVERSED.md](./WEBSOCKET_PROTOCOL_REVERSED.md) 完全一致：

1. **控制协议** (`control_request`/`control_response`)
   - `can_use_tool` - 工具权限审批
   - `initialize` - 会话初始化
   - `interrupt` - 中断请求
   - `set_permission_mode` - 设置权限模式
   - `mcp_message` - MCP 消息
   - `rewind_files` - 文件回滚
   - `mcp_reconnect` - MCP 重连
   - `mcp_toggle` - MCP 开关
   - `stop_task` - 停止任务

2. **Hook 协议** (`hook_callback_request`/`hook_callback_response`)
   - `pre_tool_use`
   - `post_tool_use`
   - `post_tool_use_failure`
   - `notification`
   - `stop`
   - `subagent_start`
   - `subagent_stop`
   - `pre_compact`
   - `permission_request`

3. **消息协议**
   - `user` - 用户消息
   - `assistant` - AI 响应
   - `system` - 系统消息
   - `result` - 最终结果
   - `stream_event` - 流式事件

---

## 协议文档对比

### Python SDK 的"文档"

**位置**：代码中的类型定义

**内容**：
- TypedDict 类型定义
- 少量代码注释
- 没有示例
- 没有流程说明

**目的**：内部实现，不鼓励用户直接使用协议

### 我们的协议文档

**位置**：[docs/WEBSOCKET_PROTOCOL_REVERSED.md](./WEBSOCKET_PROTOCOL_REVERSED.md)

**内容**：
- ✅ 完整的消息流程图
- ✅ 详细的字段说明
- ✅ 实际的 JSON 示例
- ✅ 使用场景说明
- ✅ 错误处理指南

**目的**：独立实现 Claude Code 集成

### 结论

**我们的协议文档比 Python SDK 更有价值**，因为：

1. Python SDK 假设用户通过 API 使用，不需要了解协议细节
2. 我们的文档是为了**直接实现协议**而写的，更详细
3. Python SDK 的类型定义只是协议的"骨架"，我们的文档是"完整说明书"

---

## Claude Code CLI 的两种模式

通过分析 Python SDK，我们发现 Claude Code CLI 支持两种 SDK 集成模式：

### 模式 1：stdin/stdout（Python SDK 使用）

```bash
claude --input-format stream-json [其他参数]
```

- 通过标准输入/输出传输 NDJSON
- 更简单、更可靠
- 无需网络层
- 无端口冲突

### 模式 2：WebSocket（我们使用）

```bash
claude --sdk-url ws://localhost:9800/ws/cli/session-id
```

- 通过 WebSocket 传输 NDJSON
- 需要额外的 WebSocket 服务器
- 支持远程连接
- 更复杂的架构

### 协议一致性

**两种模式使用完全相同的 NDJSON 协议**，只是传输层不同。

---

## 优势对比

### Python SDK 的优势

1. ✅ **无需 WebSocket 服务器**：减少一层网络抽象
2. ✅ **更好的错误处理**：直接读取 stderr
3. ✅ **更简单的进程管理**：标准 stdin/stdout 管道
4. ✅ **跨平台一致性**：anyio 统一了 asyncio/trio
5. ✅ **无端口冲突**：不需要管理端口分配
6. ✅ **调试友好**：可以直接重定向 stdin/stdout 进行测试

### 我们实现的优势

1. ✅ **支持远程连接**：WebSocket 可以跨网络
2. ✅ **多会话管理**：每个飞书 chat 独立 session
3. ✅ **工作目录切换**：`/cd` 命令支持
4. ✅ **已经稳定运行**：现有架构已验证可行

---

## 可借鉴的改进点

### 1. 考虑迁移到 stdin/stdout 模式

**优点**：
- 简化架构，移除 WebSocket 服务器
- 更可靠的进程通信
- 更好的错误处理

**缺点**：
- 需要重构现有代码
- 失去 WebSocket 的灵活性

**建议**：暂时保持现有架构，未来可以考虑迁移

### 2. 改进进程生命周期管理

学习 Python SDK 的优雅关闭流程：

```typescript
async close() {
  // 1. 发送 end 消息
  await this.write('{"type": "end"}\n');

  // 2. 等待进程退出（超时 5 秒）
  await Promise.race([
    this.process.waitForExit(),
    sleep(5000)
  ]);

  // 3. 超时则强制终止
  if (this.process.isRunning()) {
    this.process.kill();
  }
}
```

### 3. 统一流式模式

内部总是使用流式模式，简化逻辑：

```typescript
// 即使用户传入字符串，也转换为流式消息
const messages = typeof prompt === 'string'
  ? [{ type: 'user', message: { role: 'user', content: prompt } }]
  : prompt;
```

### 4. 会话存储直接读取

不需要通过 CLI 查询会话，直接读取 `.jsonl` 文件：

```typescript
function listSessions(cwd: string): SessionInfo[] {
  const sessionDir = path.join(
    os.homedir(),
    '.claude/projects',
    sanitizePath(cwd)
  );

  return fs.readdirSync(sessionDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => parseSessionMetadata(f));
}
```

---

## 总结

### 核心发现

1. **Python SDK 使用 stdin/stdout，而非 WebSocket**
   - 更简单、更可靠
   - 但我们的 WebSocket 方式也完全可行

2. **协议完全一致**
   - 我们反向出来的协议是准确的
   - Python SDK 验证了我们的理解

3. **我们的协议文档更完整**
   - Python SDK 只有类型定义
   - 我们的文档有完整的说明和示例

### 建议

1. **保持现有架构**
   - WebSocket 方式已经稳定运行
   - 支持多会话管理和工作目录切换
   - 迁移成本高，收益有限

2. **借鉴优秀实践**
   - 改进进程生命周期管理
   - 统一流式模式处理
   - 考虑直接读取会话文件

3. **保留协议文档**
   - 我们的文档是独立实现的重要参考
   - 比 Python SDK 的类型定义更有价值

---

## 参考资料

- [Claude Agent SDK Python 仓库](https://github.com/anthropics/claude-agent-sdk-python)
- [本地克隆路径](c:\work\claude-agent-sdk-python)
- [我们的协议文档](./WEBSOCKET_PROTOCOL_REVERSED.md)
- [我们的项目文档](../CLAUDE.md)

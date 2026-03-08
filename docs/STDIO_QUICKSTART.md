# Claude Code CLI stdin/stdout 通信协议

## 概述

本文档记录了通过 stdin/stdout 与 Claude Code CLI 进行通信的正确方法，基于对 Python SDK 的分析和实际测试验证。

## 启动参数

必须使用以下参数启动 CLI：

```bash
claude --print --verbose --input-format stream-json --output-format stream-json
```

### 关键参数说明

- `--print`: 启用打印模式
- `--verbose`: **必需**，`--output-format stream-json` 要求必须配合 `--verbose` 使用
- `--input-format stream-json`: 输入格式为流式 JSON（NDJSON）
- `--output-format stream-json`: 输出格式为流式 JSON（NDJSON）

### 常见错误

❌ **错误**：缺少 `--verbose` 参数
```
Error: When using --print, --output-format=stream-json requires --verbose
```

## 通信流程

### 1. 启动进程

```javascript
const { spawn } = require('child_process');

const env = { ...process.env };
delete env.CLAUDECODE; // 清除环境变量，避免嵌套调用

const cli = spawn('claude', [
  '--print',
  '--verbose',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json'
], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env
});
```

### 2. 读取输出

使用 `readline` 逐行解析 NDJSON：

```javascript
const readline = require('readline');

const rl = readline.createInterface({
  input: cli.stdout,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    // 处理消息
  } catch (e) {
    console.error('解析错误:', e.message);
  }
});
```

### 3. 初始化

发送 `control_request` 进行初始化：

```javascript
const initRequest = {
  type: 'control_request',
  request_id: 'req_1',
  request: {
    subtype: 'initialize',
    hooks: null
  }
};

cli.stdin.write(JSON.stringify(initRequest) + '\n');
```

### 4. 等待初始化响应

接收 `control_response`：

```javascript
if (msg.type === 'control_response') {
  console.log('初始化完成');
  // 可以开始发送用户消息
}
```

响应示例：
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "req_1",
    "response": {
      "commands": [...],
      "output_style": "default",
      "models": [...],
      "account": {...},
      "pid": 12345
    }
  }
}
```

### 5. 发送用户消息

**正确格式**：

```javascript
const userMsg = {
  type: 'user',
  session_id: '',
  message: {
    role: 'user',
    content: 'hello, what time is it?'
  },
  parent_tool_use_id: null
};

cli.stdin.write(JSON.stringify(userMsg) + '\n');
```

### 常见错误格式

❌ **错误 1**：直接发送 `message` 对象
```javascript
// 错误！
{
  message: {
    role: 'user',
    content: '...'
  }
}
```

❌ **错误 2**：使用 `type` 和 `text` 字段
```javascript
// 错误！
{
  type: 'user',
  text: '...'
}
```

错误信息：
```
Error parsing streaming input line: TypeError: undefined is not an object (evaluating '$.message.role')
```

### 6. 接收响应

#### system init 消息

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "...",
  "uuid": "..."
}
```

#### assistant 消息（流式）

```json
{
  "type": "assistant",
  "text": "部分文本内容",
  "session_id": "...",
  "uuid": "..."
}
```

#### result 消息（完成）

```json
{
  "type": "result",
  "result": "success",
  "session_id": "...",
  "uuid": "..."
}
```

## 完整示例

参见 [tests/stdio-protocol.test.ts](../tests/stdio-protocol.test.ts)

## 消息类型总结

### 输入消息（stdin）

| 类型 | 用途 | 格式 |
|------|------|------|
| `control_request` | 初始化、控制命令 | `{ type, request_id, request: { subtype, ... } }` |
| `user` | 用户消息 | `{ type, session_id, message: { role, content }, parent_tool_use_id }` |

### 输出消息（stdout）

| 类型 | 子类型 | 说明 |
|------|--------|------|
| `system` | `hook_started` | Hook 开始执行 |
| `system` | `hook_response` | Hook 执行完成 |
| `system` | `init` | 会话初始化完成 |
| `control_response` | - | 控制请求响应 |
| `assistant` | - | AI 响应（流式） |
| `result` | - | 任务完成 |

## 参考资料

- Python SDK: `claude-agent-sdk-python/src/claude_agent_sdk/_internal/`
  - `transport/subprocess_cli.py`: CLI 启动和参数配置
  - `query.py`: 控制协议和消息格式
  - `client.py`: 完整的通信流程

## 测试验证

运行测试脚本：

```bash
npm run test:stdio
```

预期输出：
```
[测试开始] Claude Code CLI stdin/stdout 通信
[命令] claude --print --verbose --input-format stream-json --output-format stream-json
[进程启动] PID: xxxxx
[系统消息] hook_started
[系统消息] hook_response
[发送] control_request (initialize)
[初始化完成]
[发送] 用户消息: hello, what time is it?
[会话初始化] session_id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
你好！根据系统信息，今天是 2026 年 3 月 7 日...
[任务完成] result: success
```

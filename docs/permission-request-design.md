# 权限请求功能设计分析

## 背景

当前项目通过 stdin/stdout NDJSON 协议与 Claude Code CLI 通信，所有工具权限请求（`control_request/can_use_tool`）都自动批准。

需求：实现交互式权限请求，让用户通过飞书消息批准/拒绝工具调用。

## 参考项目：Claude-to-IM-skill

### 核心架构

Claude-to-IM-skill 使用 **Claude Agent SDK**，通过高层 API 实现权限请求：

```typescript
// llm-provider.ts
canUseTool: async (toolName, input, opts) => {
  if (autoApprove) {
    return { behavior: 'allow', updatedInput: input };
  }

  // 发送 SSE 事件
  controller.enqueue(sseEvent('permission_request', {...}));

  // 阻塞等待用户响应
  const result = await pendingPerms.waitFor(opts.toolUseID);

  return result.behavior === 'allow'
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: result.message };
}
```

**关键点：**
- SDK 的 `canUseTool` 是 **async 回调**
- 可以安全地 `await` 等待用户响应
- SDK 自动处理阻塞，不影响其他消息

### PendingPermissions 设计

```typescript
class PendingPermissions {
  private pending = new Map<string, {
    resolve: (r: PermissionResult) => void;
    timer: NodeJS.Timeout;
  }>();

  waitFor(toolUseID: string): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ behavior: 'deny', message: 'Timeout' });
      }, 5 * 60 * 1000);
      this.pending.set(toolUseID, { resolve, timer });
    });
  }

  resolve(id: string, resolution: PermissionResolution): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    entry.resolve(resolution);
    this.pending.delete(id);
    return true;
  }
}
```

**特点：**
- Promise 作为异步等待机制
- 5 分钟超时自动拒绝
- 线程安全（Map 操作是原子的）

## 本项目的架构差异

### 关键差异：低层协议 vs 高层 SDK

**Claude-to-IM-skill:**
```
用户消息 → SDK.query() → canUseTool 回调 (async) → await 用户响应
```

**本项目:**
```
用户消息 → stdin → CLI → stdout → handleControlRequest (sync) → 必须立即响应？
```

### CLI 协议的阻塞行为

从 `PROTOCOL_SPEC.md`:

> ### Timeout Behavior
> - If the server never responds to `can_use_tool`, the CLI blocks indefinitely
> - The CLI can send `control_cancel_request` to cancel its own pending request
> - On transport close, all pending requests are rejected

**重要发现：CLI 会阻塞等待 `control_response`**

这意味着：
- CLI 发送 `control_request` 后会停止处理
- 在收到响应前，不会发送后续的 `assistant`/`result` 消息
- 我们的响应可以延迟任意时间（直到用户批准/拒绝）
- **不需要担心消息顺序问题**

### 当前实现

```typescript
// bridge.ts:234-259
private handleControlRequest(msg: CLIControlRequestMessage) {
  logger.info('[CLIBridge] Received control_request', {...});

  // MVP: 自动批准所有工具请求
  const ndjson = JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: msg.request_id,
      response: {
        behavior: 'allow',
        updatedInput: msg.request.input,
      },
    },
  });
  this.sendRaw(ndjson);
}
```

**特点：**
- 同步方法，立即响应
- 在 `routeMessage()` 中被调用（同步调用链）
- 无法 `await` 等待用户响应

## 实现方案对比

### 方案 A：延迟响应（推荐）

**核心思路：** 不在 `handleControlRequest` 中等待，而是延迟发送响应。

#### 实现逻辑

1. 收到 `control_request` 时，保存 `request_id`
2. 触发回调通知上层（不等待）
3. 立即返回（不发送 `control_response`）
4. 用户响应时，通过新方法发送 `control_response`

```typescript
// bridge.ts
private pendingRequests = new Map<string, CLIControlRequestMessage>();

private handleControlRequest(msg: CLIControlRequestMessage) {
  if (msg.request.subtype === 'can_use_tool') {
    if (this.onPermissionRequest) {
      // 保存请求
      this.pendingRequests.set(msg.request_id, msg);

      // 触发回调（不等待）
      this.onPermissionRequest({
        requestId: msg.request_id,
        toolName: msg.request.tool_name,
        input: msg.request.input,
      }).catch(err => {
        logger.error('[CLIBridge] Permission callback failed', { error: err });
        this.sendPermissionDeny(msg.request_id, 'Internal error');
      });

      // 立即返回，不发送响应
      return;
    }

    // 降级：自动批准
    this.autoApprove(msg);
  }
}

// 新增：外部调用，发送响应
sendPermissionResponse(requestId: string, result: PermissionResult) {
  const msg = this.pendingRequests.get(requestId);
  if (!msg) {
    logger.warn('[CLIBridge] Unknown permission request', { requestId });
    return;
  }

  this.pendingRequests.delete(requestId);

  const response = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: {
        behavior: result.behavior,
        updatedInput: result.behavior === 'allow' ? msg.request.input : undefined,
        message: result.message,
      },
    },
  };

  this.sendRaw(JSON.stringify(response));
}
```

#### 调用链

```
CLI → control_request
  ↓
CLIBridge.handleControlRequest() (同步，立即返回)
  ↓
触发 onPermissionRequest 回调
  ↓
ChatManager.onPermissionRequest() (async)
  ↓
发送飞书消息
  ↓
await pendingPerms.waitFor() (阻塞等待)
  ↓ (用户点击批准/拒绝)
pendingPerms.resolve()
  ↓
Agent.sendPermissionResponse()
  ↓
CLIBridge.sendPermissionResponse()
  ↓
CLI 收到 control_response，继续执行
```

#### 优点

- **不改变 routeMessage 的同步性质**：其他消息处理保持不变
- **延迟响应是合法的**：CLI 会阻塞等待，响应可以在任意时间发送
- **代码最简洁**：不需要消息队列，不需要异步化整个调用链
- **完全向后兼容**：无回调时自动批准（当前行为）
- **风险最低**：改动最小，影响范围可控

#### 缺点

- 需要保存 `pendingRequests` 状态
- 回调和响应发送分离，调用链稍复杂

#### 改动量

- `bridge.ts`: 约 40 行（保存请求 + 新增响应方法）
- `agent.ts`: 约 15 行（暴露回调和响应接口）
- `chat-manager.ts`: 约 30 行（集成 PendingPermissions）
- `message.handler.ts`: 约 20 行（处理 `/approve` `/deny` 命令）
- `message.service.ts`: 约 20 行（发送权限请求消息）
- `permission-gateway.ts`: 约 50 行（复用 Claude-to-IM-skill 代码）

**总计：约 175 行**

---

### 方案 B：消息队列 + 完全异步化

**核心思路：** 将消息处理改为异步队列，保证串行处理。

#### 实现逻辑

```typescript
// bridge.ts
private messageQueue: string[] = [];
private processing = false;

attachProcess(process: ChildProcess) {
  this.process = process;
  if (process.stdout) {
    this.rl = readline.createInterface({
      input: process.stdout,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line: string) => {
      this.messageQueue.push(line);
      this.processQueue();  // 触发处理
    });
  }
  setTimeout(() => this.sendInitialize(), 1000);
}

private processQueue() {
  if (this.processing) return;
  this.processing = true;

  setImmediate(async () => {
    while (this.messageQueue.length > 0) {
      const line = this.messageQueue.shift()!;
      await this.handleCLIData(line);
    }
    this.processing = false;
  });
}

private async handleCLIData(raw: string) {
  const line = raw.trim();
  if (!line) return;

  let msg: CLIMessage;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  await this.routeMessage(msg);
}

private async routeMessage(msg: CLIMessage) {
  switch (msg.type) {
    case 'control_request':
      await this.handleControlRequest(msg as CLIControlRequestMessage);
      break;
    // ... 其他 case 保持同步
  }
}

private async handleControlRequest(msg: CLIControlRequestMessage) {
  if (msg.request.subtype === 'can_use_tool') {
    if (this.onPermissionRequest) {
      const result = await this.onPermissionRequest({...});
      this.sendPermissionResponse(msg.request_id, result);
    } else {
      this.autoApprove(msg);
    }
  }
}
```

#### 优点

- **消息顺序严格保证**：队列确保串行处理
- **async/await 语义清晰**：直接在 handleControlRequest 中等待
- **不阻塞事件循环**：使用 setImmediate

#### 缺点

- **改动较大**：需要异步化整个调用链
- **增加复杂度**：引入队列逻辑
- **过度设计**：CLI 已经保证顺序，队列是冗余的

#### 改动量

- `bridge.ts`: 约 60 行（队列逻辑 + 异步化）
- 其他文件同方案 A

**总计：约 195 行**

---

### 方案 C：仅异步化 control_request

**核心思路：** 只将 `handleControlRequest` 改为异步，其他消息保持同步。

#### 实现逻辑

```typescript
private routeMessage(msg: CLIMessage) {
  switch (msg.type) {
    case 'control_request':
      // 异步处理，但不阻塞其他消息
      this.handleControlRequestAsync(msg);
      break;
    case 'assistant':
      this.handleAssistant(msg);  // 同步
      break;
    case 'result':
      this.handleResult();  // 同步
      break;
  }
}

private handleControlRequestAsync(msg: CLIControlRequestMessage) {
  (async () => {
    if (this.onPermissionRequest) {
      const result = await this.onPermissionRequest({...});
      this.sendResponse(msg.request_id, result);
    } else {
      this.autoApprove(msg);
    }
  })().catch(err => {
    logger.error('[CLIBridge] Permission request failed', { error: err });
    this.sendDeny(msg.request_id, 'Internal error');
  });
}
```

#### 优点

- **改动最小**：只修改 control_request 处理
- **不影响其他消息**：保持同步处理

#### 缺点

- **违反协议顺序**：虽然 CLI 会阻塞，但我们的代码可能在响应前就处理了后续消息（如果有的话）
- **理论上的风险**：依赖 CLI 的阻塞行为，如果 CLI 实现变化可能出问题

#### 改动量

**总计：约 165 行**

---

## 方案对比总结

| 维度 | 方案 A：延迟响应 | 方案 B：消息队列 | 方案 C：仅异步化 |
|------|----------------|----------------|----------------|
| **改动量** | 约 175 行 | 约 195 行 | 约 165 行 |
| **代码复杂度** | 低 | 中 | 低 |
| **风险** | 最低 | 低 | 中 |
| **是否异步化** | 回调异步，主流程同步 | 完全异步化 | 部分异步化 |
| **消息顺序保证** | 依赖 CLI 阻塞 | 队列保证 | 依赖 CLI 阻塞 |
| **向后兼容** | ✅ 完全兼容 | ✅ 完全兼容 | ✅ 完全兼容 |
| **可维护性** | 高 | 中 | 中 |

## 推荐方案：方案 A（延迟响应）

### 理由

1. **最符合协议语义**
   - CLI 阻塞等待响应
   - 延迟响应是合法且预期的行为
   - 不需要额外的同步机制

2. **改动最小且安全**
   - 不改变现有的同步调用链
   - 只在需要的地方添加异步逻辑
   - 影响范围可控

3. **代码最清晰**
   - 职责分离：handleControlRequest 负责接收，sendPermissionResponse 负责响应
   - 调用链明确：回调 → 等待 → 响应
   - 易于理解和维护

4. **借鉴成熟实践**
   - PendingPermissions 直接复用 Claude-to-IM-skill 的实现
   - 超时、清理等边界情况已验证

### 风险评估

**低风险：**
- CLI 协议明确支持延迟响应
- 不改变现有消息处理逻辑
- 降级策略清晰（无回调时自动批准）

**需要注意：**
- 进程退出时清理 pendingRequests
- 超时处理（PendingPermissions 已实现）
- 多个 chat 的 requestId 隔离（通过 chatId 区分）

## 下一步

1. 实现 `permission-gateway.ts`（复用代码）
2. 修改 `bridge.ts` 添加延迟响应逻辑
3. 修改 `agent.ts` 暴露权限接口
4. 修改 `chat-manager.ts` 集成 PendingPermissions
5. 修改 `message.handler.ts` 处理权限命令
6. 修改 `message.service.ts` 发送权限请求消息
7. 测试完整流程


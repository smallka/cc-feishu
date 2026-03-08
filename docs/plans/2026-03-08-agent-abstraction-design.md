# Agent 对象抽象设计

## 概述

将 Claude Code CLI 的 launcher 和 bridge 封装为独立的 Agent 对象，简化 SessionManager 的职责，提升代码可维护性和可测试性。

## 设计目标

1. **职责分离**：Agent 负责单个 CLI 进程生命周期，SessionManager 负责多个 Agent 的管理
2. **简化逻辑**：移除流式输出，使用纯文本消息
3. **易于追踪**：通过 agentId 追踪完整生命周期
4. **保持功能**：支持消息发送、中断、会话恢复等核心功能

## 核心设计

### Agent 类

**职责**：封装单个 Claude Code CLI 进程的完整生命周期

**不可变属性**：
- `agentId`：随机生成的唯一标识符（用于日志追踪）
- `cwd`：工作目录（创建时指定，不可改变）
- `sessionId`：CLI 会话 ID（创建时指定或生成）

**生命周期**：
```
创建 Agent (构造函数)
  ↓
创建 Launcher + Bridge
  ↓
启动 CLI 进程
  ↓
Bridge 连接进程
  ↓
等待初始化 (system/init)
  ↓
就绪，可接收消息
  ↓
sendMessage() → 等待初始化 → 发送消息 → 收到响应 → 触发回调
  ↓
destroy() → 杀掉进程 → 清理资源
```

**公开接口**：
```typescript
class Agent {
  constructor(cwd: string, resumeSessionId?: string)

  // 消息发送（自动等待初始化完成）
  async sendMessage(text: string): Promise<void>

  // 中断当前任务
  interrupt(): boolean

  // 销毁 Agent（杀掉进程，可选传入 error）
  async destroy(error?: Error): Promise<void>

  // 只读属性
  getAgentId(): string
  getCwd(): string
  getSessionId(): string
  isAlive(): boolean

  // 设置回调
  onResponse(callback: (text: string) => void): void
  onError(callback: (error: Error) => void): void
}
```

**内部实现**：
- `launcher: CLILauncher` - 管理 CLI 进程
- `bridge: CLIBridge` - 管理 NDJSON 协议通信
- `destroyed: boolean` - 标记是否已销毁
- `onResponseCallback` - 响应回调
- `onErrorCallback` - 错误回调

**异常处理机制**：

参考 Node.js TCP Socket 的设计，统一通过 `destroy()` 方法处理所有关闭场景：

1. **主动关闭**：`await agent.destroy()` - 不传 error 参数，不触发 onError 回调
2. **异常关闭**：`await agent.destroy(error)` - 传入 error 参数，触发 onError 回调

**异常场景处理**：

- **CLI 进程意外退出**：
  ```typescript
  launcher.onExit((code) => {
    if (this.destroyed) return;  // 已被主动销毁，忽略

    const error = new Error(`CLI process exited unexpectedly with code ${code}`);
    this.destroy(error);  // 统一通过 destroy 处理
  });
  ```

- **初始化超时**：
  ```typescript
  async sendMessage(text: string): Promise<void> {
    if (this.destroyed) {
      logger.warn('[Agent] Cannot send message, agent destroyed');
      return;  // 静默返回，不抛异常
    }

    try {
      await this.bridge.waitForInit();
    } catch (err) {
      await this.destroy(err as Error);  // 初始化失败，销毁 Agent
      throw err;
    }

    this.bridge.sendUserMessage(text);
  }
  ```

- **destroyed 标记的作用**：
  - 防止重复销毁
  - 区分主动关闭和异常关闭
  - `isAlive()` 返回 `!this.destroyed && this.launcher.isAlive()`

**onError 回调的作用**：
- 记录错误日志（关联 chatId）
- 向用户发送错误消息
- **不负责清理 agents Map**（由 `getOrCreateAgent()` 统一处理）

**destroyed 状态检查**：

所有操作方法都需要检查 `destroyed` 状态：

1. **sendMessage(text: string)**
   ```typescript
   if (this.destroyed) {
     logger.warn('[Agent] Cannot send message, agent destroyed');
     return;  // 静默返回，不抛异常
   }
   ```

2. **interrupt()**
   ```typescript
   if (this.destroyed) {
     logger.warn('[Agent] Cannot interrupt, agent destroyed');
     return false;
   }
   ```

3. **destroy(error?: Error)**
   ```typescript
   if (this.destroyed) {
     return;  // 防止重复销毁
   }
   ```

4. **isAlive()**
   ```typescript
   return !this.destroyed && this.launcher.isAlive();
   ```

**不需要检查 destroyed 的接口**：
- `getAgentId()` / `getCwd()` / `getSessionId()` - 只读属性，即使销毁后仍可访问
- `onResponse()` / `onError()` - 设置回调，不执行操作

### SessionManager 简化

**核心变化**：
- `sessions: Map<string, Session>` → `agents: Map<string, Agent>`
- 移除 `streamingCards`、`pendingCallbacks`
- 移除 `resumeSession()`、`listResumableSessions()`、`restartAllSessions()`
- `sendMessage()` 不再有 `onDone` 参数

**保留功能**：
```typescript
class SessionManager {
  // 发送消息
  async sendMessage(chatId: string, text: string): Promise<void>

  // 中断会话
  interruptSession(chatId: string): 'success' | 'no_session' | 'not_running'

  // 切换工作目录（销毁旧 Agent，下次消息时创建新 Agent）
  async switchCwd(chatId: string, newCwd: string): Promise<void>

  // 重置会话（销毁 Agent，清除持久化数据）
  async resetSession(chatId: string): Promise<void>

  // 查询会话状态
  getSessionInfo(chatId: string): string

  // 停止所有会话
  async stop(): Promise<void>

  // 内部方法
  private getOrCreateAgent(chatId: string): Agent
  private sendPlainText(chatId: string, text: string): void
}
```

**Agent 创建逻辑**：
```typescript
private getOrCreateAgent(chatId: string): Agent {
  // 1. 检查是否有存活的 Agent，有则复用
  let agent = this.agents.get(chatId);
  if (agent?.isAlive()) {
    return agent;
  }

  // 2. 清理旧 Agent
  if (agent) {
    agent.destroy().catch(() => {});
    this.agents.delete(chatId);
  }

  // 3. 从 chatManager 获取 cwd 和 sessionId
  const cwd = chatManager.getCwd(chatId);
  const storedSessionId = chatManager.getSessionId(chatId);
  const storedCwd = chatManager.getCwd(chatId);

  // 4. 只有当 cwd 匹配时才 resume
  const resumeSessionId = (storedSessionId && storedCwd === cwd)
    ? storedSessionId
    : undefined;

  // 5. 创建新 Agent（同步构造函数，立即返回）
  agent = new Agent(cwd, resumeSessionId);

  // 6. 立即保存到 Map（防止并发创建）
  this.agents.set(chatId, agent);

  // 7. 设置回调
  agent.onResponse((text) => {
    this.sendPlainText(chatId, text);
  });

  agent.onError((error) => {
    // 只负责通知用户，不删除 agents Map
    // getOrCreateAgent() 会在下次调用时检查 isAlive() 并清理
    logger.error('[SessionManager] Agent error', { chatId, error: error.message });
    messageService.sendTextMessage(chatId, `错误: ${error.message}`);
  });

  // 8. 如果是新会话，持久化 sessionId
  if (!resumeSessionId) {
    chatManager.setSession(chatId, cwd, agent.getSessionId());
  }

  return agent;
}
```

**并发安全说明**：
- Agent 构造函数是同步的，立即返回
- 创建后立即放入 `agents` Map，阻止并发创建
- CLI 进程在后台启动，`sendMessage()` 时才等待初始化
- 无需 Promise 缓存或锁机制

**消息串行化处理**：

当前代码存在的问题：
- `collectedText` 被后续消息清空（bridge.ts:116）
- `pendingCallbacks` 被覆盖（session-manager.ts:40）
- `result` 没有请求级关联，导致消息混淆

新设计的解决方案：
```typescript
// SessionManager
async sendMessage(chatId: string, text: string): Promise<void> {
  const agent = this.getOrCreateAgent(chatId);
  await agent.sendMessage(text);  // await 确保串行处理
}

// message.handler.ts
const reactionId = await messageService.addReaction(message.message_id, 'Typing');
try {
  await sessionManager.sendMessage(chatId, text);  // 等待完成
} finally {
  if (reactionId) {
    await messageService.removeReaction(message.message_id, reactionId);
  }
}
```

关键机制：
- `sendMessage()` 是 async，等待 CLI 返回 result 才 resolve
- handler 层面 await，自然串行化用户消息
- 一个 Agent 同时只处理一条消息，避免状态混淆

**生命周期管理**：
- **chatId 第一次发消息**：创建 Agent
- **/cd 切换目录**：主动调用 `agent.destroy()`，更新 cwd，下次消息时创建新 Agent
- **/new 重置会话**：主动调用 `agent.destroy()`，清除持久化数据，下次消息时创建新 Agent
- **CLI 进程异常退出**：Agent 内部调用 `destroy(error)`，触发 onError 回调通知用户
- **下次消息到达**：`getOrCreateAgent()` 检查 `isAlive()`，清理已死的 Agent，创建新 Agent

### message.handler.ts 调整

**Typing reaction 处理**：

之前：
```typescript
const reactionId = await messageService.addReaction(message.message_id, 'Typing');
await sessionManager.sendMessage(chatId, text, async () => {
  if (reactionId) {
    await messageService.removeReaction(message.message_id, reactionId);
  }
});
```

之后：
```typescript
const reactionId = await messageService.addReaction(message.message_id, 'Typing');
try {
  await sessionManager.sendMessage(chatId, text);
} finally {
  if (reactionId) {
    await messageService.removeReaction(message.message_id, reactionId);
  }
}
```

**说明**：
- 移除 `onDone` 回调参数
- 使用 `try-finally` 确保 Typing reaction 总是被移除
- 更简单、更可靠

## 日志规范

### 日志级别

- **DEBUG**：详细的执行流程、函数参数、状态变化
- **INFO**：关键操作、Agent 生命周期、命令执行结果
- **WARN**：可恢复的异常、降级处理
- **ERROR**：错误和异常

### 日志上下文字段

每条日志必须包含相关的上下文信息，方便追踪和关联：

**Agent 相关**：
- `agentId` - Agent 唯一标识
- `sessionId` - CLI 会话 ID
- `cwd` - 工作目录
- `isResume` - 是否为 resume 模式

**Chat 相关**：
- `chatId` - 飞书 chat ID

**消息相关**：
- `messageLength` / `textLength` - 消息长度（字符数）
- **不记录消息实际内容**（保护隐私）

**操作相关**：
- `operation` - 操作类型（create/send/interrupt/destroy）
- `wasDestroyed` - 销毁前的状态

### 日志示例

```typescript
// Agent 创建
logger.info('[Agent] Creating agent', {
  agentId: this.agentId,
  sessionId: this.sessionId,
  cwd: this.cwd,
  isResume: !!resumeSessionId,
  operation: 'create'
});

// 发送消息
logger.debug('[Agent] Sending message', {
  agentId: this.agentId,
  sessionId: this.sessionId,
  messageLength: text.length,
  operation: 'send'
});

// 进程退出
logger.info('[Agent] CLI process exited', {
  agentId: this.agentId,
  sessionId: this.sessionId,
  code,
  wasDestroyed: this.destroyed,
});

// 错误
logger.error('[Agent] Failed to initialize', {
  agentId: this.agentId,
  sessionId: this.sessionId,
  error: error.message,
});
```

### 完整生命周期日志

```
[Agent] Creating agent { agentId: 'abc-123', sessionId: 'xyz-789', cwd: '/path', isResume: false, operation: 'create' }
[Agent] Starting CLI process { agentId: 'abc-123', sessionId: 'xyz-789', resume: false }
[Agent] Sending message { agentId: 'abc-123', sessionId: 'xyz-789', messageLength: 42, operation: 'send' }
[Agent] Received response { agentId: 'abc-123', sessionId: 'xyz-789', textLength: 1024 }
[Agent] Interrupting { agentId: 'abc-123', sessionId: 'xyz-789', operation: 'interrupt' }
[Agent] CLI process exited { agentId: 'abc-123', sessionId: 'xyz-789', code: 1, wasDestroyed: false }
[Agent] Destroying agent { agentId: 'abc-123', sessionId: 'xyz-789', hasError: true, operation: 'destroy' }
```

### 日志目标

通过分析日志应该能够：
1. 追踪一条消息的完整流程（从接收到响应）
2. 调试 Agent 创建失败的原因
3. 分析异常退出的原因和时序
4. 关联相关的操作（通过 chatId/agentId/sessionId）

## 文件结构

```
src/claude/
├── agent.ts           # 新增：Agent 类
├── bridge.ts          # 保持不变
├── launcher.ts        # 保持不变
├── session-manager.ts # 简化：使用 Agent
├── session-scanner.ts # 保持不变
└── types.ts          # 保持不变
```

## 移除的功能

以下功能在本次重构中移除，简化设计：

1. **StreamingCard 流式输出**
   - 移除 `streamingCards` Map
   - 移除 `bridge.setOnPartialText()` 回调
   - 统一使用纯文本消息

2. **pendingCallbacks**
   - 移除 `onDone` 回调参数
   - 在 handler 层面使用 `try-finally` 处理 Typing reaction

3. **resumeSession() 方法**
   - 移除手动恢复会话的接口
   - 通过 `getOrCreateAgent()` 自动处理 resume 逻辑

4. **listResumableSessions() 方法**
   - 移除扫描可恢复会话的功能
   - 简化用户交互

5. **restartAllSessions() 方法**
   - 移除批量重启会话的功能
   - 如需重启，通过 `/new` 命令逐个处理

6. **/model 运行时切模命令**
   - 本迭代暂不支持运行时切换模型
   - 移除 `/model` 命令入口，避免依赖批量重启逻辑

## 优势

1. **职责清晰**：Agent 管理单个 CLI，SessionManager 管理多个 Agent
2. **易于测试**：Agent 可以独立测试，不依赖飞书 API
3. **日志追踪**：通过 agentId 追踪完整生命周期
4. **简化逻辑**：移除流式输出后代码量减少约 30%
5. **易于扩展**：未来可以在 Agent 层面添加功能（如重试、超时控制等）
6. **统一异常处理**：参考 TCP Socket 设计，所有关闭都通过 `destroy()` 统一处理
7. **资源清理解耦**：onError 只负责通知，资源清理由 `getOrCreateAgent()` 统一处理

## 异常处理设计总结

### destroyed 标记的语义

`destroyed = true` 表示 Agent 已不可用，进程已退出或正在退出。

### 所有场景的处理

1. **主动销毁**（用户调用 `/cd` 或 `/new`）
   - SessionManager 调用 `agent.destroy()`
   - `destroyed = true`（同步设置）
   - 发送 SIGTERM，等待进程退出
   - `launcher.onExit()` 触发，检查 `destroyed` 已为 true，不触发 onError

2. **CLI 进程异常退出**（崩溃、OOM 等）
   - `launcher.onExit()` 触发，检查 `destroyed` 为 false
   - 调用 `destroy(error)` 传入错误
   - 设置 `destroyed = true`
   - 触发 onError 回调，通知用户

3. **初始化超时**
   - `sendMessage()` 中 `waitForInit()` 超时
   - 调用 `destroy(error)` 传入错误
   - 触发 onError 回调，通知用户

4. **下次消息到达**
   - `getOrCreateAgent()` 检查 `agent?.isAlive()`
   - 如果 Agent 已死，清理并创建新 Agent
   - 不依赖 onError 回调删除 Map

### 关键设计原则

- **统一入口**：所有关闭都通过 `destroy()` 方法
- **error 参数**：区分主动关闭（无 error）和异常关闭（有 error）
- **职责分离**：onError 只负责通知，清理由调用方处理
- **防御性编程**：`sendMessage()` 检查 `destroyed` 但不抛异常，静默返回

## 实现步骤

1. 创建 `src/claude/agent.ts`，实现 Agent 类
2. 修改 `src/claude/session-manager.ts`，使用 Agent 替代 Session
3. 修改 `src/handlers/message.handler.ts`，调整 Typing reaction 处理
4. 修改 `src/handlers/message.handler.ts`，移除 `/model` 命令分支和帮助文案
5. 移除 `src/services/streaming-card.ts`（如果不再需要）
6. 更新相关测试
7. 验证功能：消息发送、中断、切换目录、重置会话

## 风险和注意事项

1. **初始化等待**：`sendMessage()` 会等待初始化完成，可能增加首次消息的延迟
2. **并发安全**：需要确保 `getOrCreateAgent()` 的并发安全性
3. **资源清理时序**：确保 `destroy()` 中先设置 `destroyed = true`，再 kill 进程
4. **onError 回调时机**：确保异常情况下 onError 在 destroy 内部被触发

## 后续扩展

未来可以考虑的扩展：

1. **恢复流式输出**：在 Agent 层面添加 `onPartialText` 回调
2. **消息队列**：在 Agent 内部实现消息队列，支持批量发送
3. **重试机制**：在 Agent 层面实现自动重试
4. **超时控制**：在 Agent 层面实现消息超时控制
5. **状态机**：将 Agent 改为状态机，更清晰地管理状态转换
6. **运行时切模**：在具备明确会话重启策略后，恢复 `/model` 命令

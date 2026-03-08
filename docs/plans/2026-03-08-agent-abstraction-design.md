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

  // 销毁 Agent（杀掉进程）
  async destroy(): Promise<void>

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

**错误处理**：
通过 `onError` 回调上报以下错误：
- CLI 进程启动失败
- 初始化超时（15 秒）
- CLI 进程意外退出
- Resume 失败

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

  // 5. 创建新 Agent
  agent = new Agent(cwd, resumeSessionId);

  // 6. 设置回调
  agent.onResponse((text) => {
    this.sendPlainText(chatId, text);
  });

  agent.onError((error) => {
    logger.error('[SessionManager] Agent error', { chatId, error: error.message });
    messageService.sendTextMessage(chatId, `错误: ${error.message}`);
    this.agents.delete(chatId);
  });

  // 7. 保存到 Map
  this.agents.set(chatId, agent);

  // 8. 如果是新会话，持久化 sessionId
  if (!resumeSessionId) {
    chatManager.setSession(chatId, cwd, agent.getSessionId());
  }

  return agent;
}
```

**生命周期管理**：
- **chatId 第一次发消息**：创建 Agent
- **/cd 切换目录**：销毁旧 Agent，更新 cwd，下次消息时创建新 Agent
- **/new 重置会话**：销毁 Agent，清除持久化数据，下次消息时创建新 Agent
- **CLI 进程退出**：触发 onError 回调，SessionManager 删除 Agent

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

## 日志追踪

通过 `agentId` 追踪完整生命周期：

```
[Agent] Creating agent { agentId: 'abc-123', sessionId: 'xyz-789', cwd: '/path', isResume: false }
[Agent] Starting CLI process { agentId: 'abc-123', sessionId: 'xyz-789', resume: false }
[Agent] Sending message { agentId: 'abc-123', sessionId: 'xyz-789', messageLength: 42 }
[Agent] Received response { agentId: 'abc-123', sessionId: 'xyz-789', textLength: 1024 }
[Agent] Interrupting { agentId: 'abc-123', sessionId: 'xyz-789' }
[Agent] Destroying agent { agentId: 'abc-123', sessionId: 'xyz-789' }
```

**日志上下文字段**：
- `agentId` - Agent 唯一标识
- `sessionId` - CLI 会话 ID
- `chatId` - 飞书会话 ID
- `cwd` - 工作目录
- `messageLength` / `textLength` - 消息长度

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

## 优势

1. **职责清晰**：Agent 管理单个 CLI，SessionManager 管理多个 Agent
2. **易于测试**：Agent 可以独立测试，不依赖飞书 API
3. **日志追踪**：通过 agentId 追踪完整生命周期
4. **简化逻辑**：移除流式输出后代码量减少约 30%
5. **易于扩展**：未来可以在 Agent 层面添加功能（如重试、超时控制等）

## 实现步骤

1. 创建 `src/claude/agent.ts`，实现 Agent 类
2. 修改 `src/claude/session-manager.ts`，使用 Agent 替代 Session
3. 修改 `src/handlers/message.handler.ts`，调整 Typing reaction 处理
4. 移除 `src/services/streaming-card.ts`（如果不再需要）
5. 更新相关测试
6. 验证功能：消息发送、中断、切换目录、重置会话

## 风险和注意事项

1. **初始化等待**：`sendMessage()` 会等待初始化完成，可能增加首次消息的延迟
2. **错误处理**：需要确保所有错误都通过 `onError` 回调正确上报
3. **资源清理**：需要确保 Agent 销毁时正确清理所有资源
4. **并发安全**：需要确保 `getOrCreateAgent()` 的并发安全性

## 后续扩展

未来可以考虑的扩展：

1. **恢复流式输出**：在 Agent 层面添加 `onPartialText` 回调
2. **消息队列**：在 Agent 内部实现消息队列，支持批量发送
3. **重试机制**：在 Agent 层面实现自动重试
4. **超时控制**：在 Agent 层面实现消息超时控制
5. **状态机**：将 Agent 改为状态机，更清晰地管理状态转换

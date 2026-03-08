# 基于 --continue 的会话管理重构方案

## Context

### 问题背景
当前项目使用 `randomUUID()` 生成 sessionId，并通过 `.chat-store.json` 持久化存储 `{ chatId: { lastCwd, lastSessionId } }`。每次启动 CLI 时需要判断是使用 `--session-id <uuid>` 创建新会话，还是使用 `--resume <uuid>` 恢复已有会话。这种设计增加了代码复杂度，且需要手动管理会话生命周期。

### 改进目标
- **去除 sessionId 的显式管理**：不再生成和存储 sessionId
- **统一使用 --continue**：让 Claude Code CLI 自动管理会话恢复
- **简化代码结构**：减少会话管理的复杂度
- **保持功能完整**：/cd、/new、/status 等命令继续工作

### --continue 参数特性（已验证）
- **无参数**：不需要指定 sessionId
- **自动查找**：基于当前 cwd，查找该目录下最新修改的会话文件
- **智能恢复**：CLI 自动管理 `~/.claude/projects/<project-name>/*.jsonl` 文件
- **目录隔离**：不同 cwd 自动对应不同的 projects 目录

### 架构决策（重要变更）

**关键发现**：Claude Code CLI 不禁止多个进程同时使用 `--continue` 访问同一个 session 文件。这意味着：

1. **每个 chatId 独立的 CLI 进程**：不需要让多个 chat 共享一个进程
2. **所有进程都用 --continue**：每个进程启动时都用 `--continue`，CLI 自动处理并发访问
3. **简化会话管理**：
   - 移除 `(chatId, cwd) → session` 的映射逻辑
   - 改为 `chatId → (cwd, launcher, bridge)` 的简单映射
   - 每个 chat 有自己的 CLI 进程，但可能共享底层的 session 文件

**新架构**：
```
chatId_1 → CLI 进程 1 → --continue → ~/.claude/projects/xxx/最新.jsonl
chatId_2 → CLI 进程 2 → --continue → ~/.claude/projects/xxx/最新.jsonl (同一个文件)
```

**优势**：
- 进程隔离：每个 chat 独立的 stdin/stdout 通道
- 简化代码：不需要判断是否共享进程
- 符合 CLI 设计：让 CLI 处理并发访问和文件锁定

---

## 实施方案

### 阶段 1：核心重构（必须）

#### 1.1 简化 chat-store.ts

**文件**: `src/bot/chat-store.ts`

**变更**：
- 移除 `lastSessionId` 字段
- 删除 `getLastSessionId()` 函数
- 重命名 `setLastSession()` → `setLastCwd()`
- 重命名 `clearLastSession()` → `clearLastCwd()`

**新接口**：
```typescript
interface ChatData {
  lastCwd: string;  // 只保留 cwd
}

export function getLastCwd(chatId: string): string | undefined;
export function setLastCwd(chatId: string, cwd: string): void;
export function clearLastCwd(chatId: string): void;
```

**数据迁移**：
```typescript
function load(): StoreData {
  // ... 现有逻辑
  // 自动迁移：如果检测到 lastSessionId 字段，删除它
  for (const chatId in cache) {
    if (cache[chatId].lastSessionId) {
      delete cache[chatId].lastSessionId;
    }
  }
  return cache;
}
```

#### 1.2 简化 launcher.ts

**文件**: `src/claude/launcher.ts`

**变更**：
- 移除 `sessionId` 构造参数和字段
- 移除 `LaunchOptions.resume` 参数
- 所有启动都使用 `--continue` 参数

**新实现**：
```typescript
export interface LaunchOptions {
  cwd?: string;
  continueSession?: boolean;  // 默认 true，/new 命令时传 false
}

export class CLILauncher {
  private process: ChildProcess | null = null;
  private exitCallbacks: Array<(code: number | null) => void> = [];
  // 移除: readonly sessionId: string;

  constructor() {
    // 无需参数
  }

  start(options: LaunchOptions): void {
    const { cwd, continueSession = true } = options;
    const args = [
      '--print',
      '--verbose',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--model', config.claude.model,
    ];

    // 默认使用 --continue，除非明确指定不恢复（/new 命令）
    if (continueSession) {
      args.push('--continue');
    }

    args.push('-p', '');

    logger.info('Spawning Claude Code CLI', { cwd, continueSession });

    const env = { ...process.env };
    delete env.CLAUDECODE;

    this.process = spawn('claude', args, {
      cwd: cwd ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    // ... 其余逻辑不变
  }
}
```

#### 1.3 重构 session-manager.ts

**文件**: `src/claude/session-manager.ts`

**核心思想变更**：
- **旧逻辑**：`(chatId, cwd) → session`，同 chat 同 cwd 复用 session
- **新逻辑**：`chatId → (cwd, launcher, bridge)`，每个 chat 独立进程，都用 `--continue`

**变更**：
- 移除 sessionId 生成逻辑（`randomUUID()`）
- 移除 `canResume` 判断逻辑
- 简化 `getOrCreateSession()`：不再判断是否复用
- 更新 `setLastSession()` → `setLastCwd()`
- 更新 `clearLastSession()` → `clearLastCwd()`
- 修改 `resetSession()`：传递 `continueSession: false` 参数

**核心变更**：
```typescript
// 导入变更
import {
  getLastCwd, setLastCwd, clearLastCwd,  // 移除 getLastSessionId
} from '../bot/chat-store';

// Session 接口变更
interface Session {
  chatId: string;
  // 移除: sessionId: string;  // 改为从 bridge 动态获取
  cwd: string;
  bridge: CLIBridge;
  launcher: CLILauncher;
}

// 添加 getSession() 方法供外部访问
getSession(chatId: string): Session | undefined {
  return this.sessions.get(chatId);
}

// getOrCreateSession() 大幅简化
private getOrCreateSession(chatId: string, cwd: string, continueSession = true): Session {
  const existing = this.sessions.get(chatId);
  if (existing) {
    if (existing.cwd !== cwd) {
      throw new Error('Cannot change cwd for active session');
    }
    return existing;
  }

  // 每个 chat 创建独立的 CLI 进程
  const launcher = new CLILauncher();  // 无需传 sessionId
  const bridge = new CLIBridge(launcher.getProcess()!);  // 无需传 sessionId

  // 默认使用 --continue，/new 命令时传 continueSession: false
  launcher.start({ cwd, continueSession });

  // 等待初始化
  await bridge.waitForInit();

  if (!bridge.isInitialized()) {
    bridge.rejectInit('CLI exited before init');
    throw new Error('CLI failed to initialize');
  }

  // 保存 cwd（不再保存 sessionId）
  setLastCwd(chatId, cwd);

  const session: Session = {
    chatId,
    cwd,
    bridge,
    launcher,
  };

  this.sessions.set(chatId, session);

  logger.info('[SessionManager] Created new session', {
    chatId,
    cwd,
    continueSession,
    processId: launcher.getProcess()?.pid,
  });

  return session;
}

// resetSession() 简化：不删除文件，只是不带 --continue 启动
async resetSession(chatId: string): Promise<void> {
  const cwd = this.getCwd(chatId);

  // 关闭现有会话
  const existing = this.sessions.get(chatId);
  if (existing) {
    await this.closeStreamingCard(chatId);
    await existing.launcher.kill();
    this.sessions.delete(chatId);
  }

  // 清除存储（下次启动时不带 --continue）
  clearLastCwd(chatId);

  logger.info('[SessionManager] Session reset', { chatId, cwd });
}
```

#### 1.4 更新 bridge.ts

**文件**: `src/claude/bridge.ts`

**变更**：
- 移除 `sessionId` 构造参数
- 添加 `sessionId` 字段（初始为空）
- 从 `system/init` 消息中提取 sessionId
- 在日志中继续使用 sessionId

**新实现**：
```typescript
export class CLIBridge {
  private process: ChildProcess;
  private sessionId: string | null = null;  // 从 CLI 初始化消息中提取

  constructor(process: ChildProcess) {
    this.process = process;
  }

  // 处理 system/init 消息时提取 sessionId
  private handleSystemMessage(msg: SystemMessage): void {
    if (msg.subtype === 'init') {
      this.sessionId = msg.session_id;
      logger.info('[CLIBridge] CLI initialized', {
        sessionId: this.sessionId,
        cwd: msg.cwd,
      });
    }
  }

  // 日志中使用提取的 sessionId
  sendUserMessage(text: string): void {
    const msg: UserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    };
    this.process.stdin!.write(JSON.stringify(msg) + '\n');
    logger.debug('[CLIBridge] Sent user message', {
      sessionId: this.sessionId,
      messageLength: text.length,
    });
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}
```

---

### 阶段 2：命令调整（必须）

#### 2.1 更新 /status 命令

**文件**: `src/handlers/message.handler.ts`

**变更**：
- 从 bridge 获取 sessionId（如果有）
- 显示当前 cwd 和会话信息

**新实现**：
```typescript
if (text === '/status') {
  const cwd = sessionManager.getCwd(chatId);
  const session = sessionManager.getSession(chatId);
  const sessions = await scanSessions(cwd);

  let reply = `当前工作目录: ${cwd}\n`;

  if (session) {
    const sessionId = session.bridge.getSessionId();
    reply += `活跃会话 ID: ${sessionId || '(初始化中)'}\n`;
    reply += `进程 PID: ${session.launcher.getProcess()?.pid}\n`;
  } else {
    reply += `当前没有活跃会话\n`;
  }

  reply += `\n该目录下的会话数: ${sessions.length}\n`;

  if (sessions.length > 0) {
    reply += '\n最近的会话:\n';
    sessions.slice(0, 3).forEach((s, i) => {
      reply += `${i + 1}. 消息数: ${s.messageCount}, 最后活动: ${s.lastMessageTime.toLocaleString()}\n`;
    });
  }

  await messageService.sendTextMessage(chatId, reply);
  return;
}
```

#### 2.2 移除 /resume 命令

**文件**: `src/handlers/message.handler.ts`

**变更**：
- 删除 `/resume` 命令处理逻辑
- 删除 `sessionManager.resumeSession()` 方法
- 删除 `sessionManager.listResumableSessions()` 方法
- 从 `/help` 中移除 `/resume` 说明

**理由**：
- 使用 `--continue` 后，CLI 自动恢复最新会话
- 不再需要手动指定 sessionId 恢复
- 简化用户体验

**注意**：`/new` 命令的实现保持不变，只是内部逻辑简化（不删除文件，只是下次不带 `--continue` 启动）

---

### 阶段 3：清理和优化（可选）

#### 3.1 更新文档

**文件**: `CLAUDE.md`

**变更**：
- 更新架构说明，移除 sessionId 相关描述
- 说明 --continue 的工作原理
- 说明多 chat 共享会话的行为
- 更新命令列表

**关键说明**：
```markdown
### 会话管理机制

- **自动恢复**: 使用 `--continue` 参数，CLI 自动恢复当前目录的最新会话
- **目录隔离**: 不同工作目录有独立的会话历史
- **每个 chat 独立进程**: 每个飞书 chat 有自己的 CLI 进程，但可能共享底层的 session 文件
- **/new 命令**: 启动不带 `--continue` 的新进程，开始全新对话
```

#### 3.2 更新日志规范

**文件**: `CLAUDE.md` 日志规范部分

**变更**：
- 移除 `sessionId` 字段要求
- 保留 `cwd` 字段
- 添加 `chatId` 字段用于追踪

---

## 关键文件清单

### 必须修改的文件（阶段 1-2）

1. **src/bot/chat-store.ts** - 简化存储接口，移除 sessionId
2. **src/claude/launcher.ts** - 移除 sessionId 参数，添加 continueSession 选项
3. **src/claude/session-manager.ts** - 重构会话管理逻辑，简化 resetSession
4. **src/claude/bridge.ts** - 移除 sessionId 构造参数
5. **src/handlers/message.handler.ts** - 移除 /resume 命令，更新 /help

### 可选修改的文件（阶段 3）

6. **CLAUDE.md** - 更新文档说明
7. **src/claude/session-scanner.ts** - 保持不变（仍用于 /status）

### 不需要修改的文件
- **src/claude/types.ts** - 类型定义保持不变
- **src/services/*.ts** - 服务层不受影响
- **src/bot/websocket.ts** - WebSocket 连接不受影响

---

## 验证方案

### 功能测试
1. **基本对话**
   - 发送消息，验证 CLI 正常响应
   - 重启 bot，验证会话自动恢复

2. **/cd 命令**
   - 切换到不同目录，验证会话隔离
   - 切换回原目录，验证会话恢复

3. **/new 命令**
   - 执行 /new，验证会话文件被删除
   - 发送消息，验证创建新会话

4. **/status 命令**
   - 验证显示当前 cwd
   - 验证显示会话数量

5. **多 chat 测试**
   - 两个 chat 在同一 cwd 下对话
   - 验证它们共享同一个会话历史

### 回归测试
- 运行现有测试套件（如果有）
- 手动测试所有命令
- 验证日志输出正确

### 数据迁移测试
- 使用旧版 `.chat-store.json` 启动
- 验证自动迁移成功
- 验证功能正常

---

## 风险评估

### 低风险
- **数据迁移**：自动删除 `lastSessionId` 字段，不影响功能
- **向后兼容**：旧的 `.chat-store.json` 可以正常加载

### 中风险
- **多 chat 共享**：可能导致隐私问题，需要文档说明
- **/new 命令**：删除文件操作需要仔细测试

### 高风险
- **会话丢失**：如果 --continue 失败，可能无法恢复历史会话
  - **缓解措施**：CLI 会自动创建新会话，不会崩溃

---

## 实施建议

### 推荐顺序
1. 创建新分支 `refactor/remove-sessionid`
2. 实施阶段 1（核心重构）
3. 本地测试基本功能
4. 实施阶段 2（命令调整）
5. 完整测试所有命令
6. 实施阶段 3（文档更新）
7. 合并到主分支

### 预计工作量
- 阶段 1：2-3 小时
- 阶段 2：1 小时
- 阶段 3：30 分钟
- 测试：1-2 小时
- **总计**：4-6 小时

### 回滚计划
- Git 分支隔离开发
- 保留 `.chat-store.json` 备份
- 如果出现严重问题，快速回滚到旧版本

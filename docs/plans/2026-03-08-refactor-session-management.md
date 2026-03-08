# ChatManager/SessionManager 重构实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 移除 SessionManager，将其职责合并到 ChatManager

**Architecture:** ChatManager 管理 chatId → Agent 映射，Agent 持有 cwd/sessionId

---

## Task 1: 增强 Agent 类

**Files:** `src/claude/agent.ts`

**Changes:**
- 添加 `private cwd: string` 字段
- 添加 `getCwd(): string` 方法
- 添加 `getSessionId(): string` 方法（已有 sessionId 字段）

**Commit:** `refactor: Agent 增加 getCwd/getSessionId 方法`

---

## Task 2: ChatManager 添加 Agent 管理

**Files:** `src/bot/chat-manager.ts`

**Changes:**
- 添加 `private agents = new Map<string, Agent>()`
- 添加 `private responseCompleteCallback: (() => void) | null = null`
- 导入 Agent、messageService、logger

**Commit:** `refactor: ChatManager 添加 Agent 管理字段`

---

## Task 3: 实现 getOrCreateAgent 方法

**Files:** `src/bot/chat-manager.ts`

**Changes:**
- 从 SessionManager 复制 `getOrCreateAgent` 私有方法
- 调整为使用 `this.store` 和 `this.agents`
- 注册 Agent 的 onResponse/onError 回调

**Commit:** `refactor: ChatManager 实现 Agent 创建逻辑`

---

## Task 4: 实现消息发送方法

**Files:** `src/bot/chat-manager.ts`

**Changes:**
- 添加 `sendMessage(chatId, text)` - 调用 getOrCreateAgent
- 添加 `sendPlainText(chatId, text)` - 处理分段
- 添加 `sendLongMessage(chatId, text, maxLen)` - 长消息分段

**Commit:** `refactor: ChatManager 实现消息发送`

---

## Task 5: 实现会话管理方法

**Files:** `src/bot/chat-manager.ts`

**Changes:**
- 添加 `interrupt(chatId)` - 返回 'success' | 'no_session' | 'not_running'
- 添加 `reset(chatId)` - 销毁 Agent 并清除数据
- 添加 `switchCwd(chatId, newCwd)` - 切换工作目录
- 添加 `getSessionInfo(chatId)` - 返回状态字符串
- 添加 `onResponseComplete(callback)` - 注册回调
- 添加 `stop()` - 停止所有 Agent

**Commit:** `refactor: ChatManager 实现会话管理方法`

---

## Task 6: 更新 message.handler

**Files:** `src/handlers/message.handler.ts`

**Changes:**
- 移除 `import { SessionManager }`
- 移除 `setSessionManager` 函数
- 改为 `import { chatManager } from '../bot/chat-manager'`
- 所有 `sessionManager.xxx()` 改为 `chatManager.xxx()`
- `chatManager.onResponseComplete()` 注册表情移除回调

**Commit:** `refactor: handler 改用 chatManager`

---

## Task 7: 更新 index.ts

**Files:** `src/index.ts`

**Changes:**
- 移除 `import { SessionManager }`
- 移除 `sessionManager` 实例化
- 移除 `setSessionManager(sessionManager)`
- 改为 `import { chatManager } from './bot/chat-manager'`
- 启动时调用 `await chatManager.start()`（如果需要）
- 关闭时调用 `await chatManager.stop()`

**Commit:** `refactor: index.ts 改用 chatManager`

---

## Task 8: 删除 SessionManager

**Files:** `src/claude/session-manager.ts`

**Changes:**
- 删除文件

**Commit:** `refactor: 移除 SessionManager`

---

## Task 9: 验证和测试

**Steps:**
1. 编译检查：`npm run build`
2. 启动测试：`npm run dev`
3. 测试命令：/help, /status, /new, /cd
4. 测试消息发送和响应
5. 测试长消息分段

**Commit:** 无需提交

---

## Rollback Plan

如果出现问题：
```bash
git revert HEAD~8..HEAD
```

恢复到重构前的状态。

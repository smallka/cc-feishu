# ChatManager 和 SessionManager 重构设计

## 背景

当前架构中存在职责重叠：
- `ChatManager`：存储 (chatId, cwd, sessionId) 映射
- `SessionManager`：管理 Agent 生命周期、消息路由、分段发送

问题：SessionManager 既依赖 ChatManager 读写数据，又管理 Agent Map，职责不清晰。

## 目标

让 `claude/` 目录的模块只负责 AI 相关功能，Agent 是最基本单位。

## 设计方案

### 架构调整

**移除**：`claude/session-manager.ts`

**保留并增强**：`bot/chat-manager.ts`

**调用链路**：
```
message.handler → ChatManager → Agent → CLIBridge → Claude Code CLI
```

### 模块职责

#### bot/chat-manager.ts

管理飞书会话到 Agent 的映射，提供业务方法：

- `sendMessage(chatId, text)` - 发送消息到 Agent
- `interrupt(chatId)` - 打断 Agent 执行
- `reset(chatId)` - 重置会话
- `switchCwd(chatId, newCwd)` - 切换工作目录
- `getSessionInfo(chatId)` - 获取会话状态
- `getCwd(chatId)` - 获取工作目录
- `onResponseComplete(callback)` - 注册响应完成回调
- `stop()` - 停止所有 Agent

内部维护：
- `agents: Map<chatId, Agent>` - Agent 实例映射
- `defaultCwd` - 默认工作目录
- Agent 生命周期管理（创建、复用、销毁）
- 消息分段发送（4000 字符限制）

#### claude/agent.ts

封装单个 Claude Code CLI 进程，需要增强：

- 内部持有 `cwd` 和 `sessionId`
- 提供 `getCwd()` 方法
- 提供 `getSessionId()` 方法
- 其他方法不变

#### handlers/message.handler.ts

解析飞书消息和命令，直接调用 ChatManager：

- 移除 `setSessionManager`
- 直接 `import { chatManager } from '../bot/chat-manager'`
- 所有 `sessionManager.xxx()` 改为 `chatManager.xxx()`
- 表情队列通过 `chatManager.onResponseComplete()` 注册

#### src/index.ts

启动流程简化：

```typescript
import { chatManager } from './bot/chat-manager';

await chatManager.start();
// ... 启动 WebSocket
```

### 数据流

**用户发送消息**：
1. 飞书 WebSocket → message.handler
2. handler 解析命令/消息
3. 调用 `chatManager.sendMessage(chatId, text)`
4. ChatManager 获取或创建 Agent
5. Agent 通过 CLIBridge 发送到 CLI 进程

**AI 响应**：
1. CLI 进程 → CLIBridge → Agent
2. Agent 触发 onResponse 回调
3. ChatManager 收到回调，分段发送消息
4. 调用 messageService 发送到飞书

### 会话恢复逻辑

ChatManager 内部维护 `sessions: Map<chatId, {cwd, sessionId}>`：

- 切换 cwd 时清除 sessionId
- 创建 Agent 时检查是否可恢复（cwd 匹配）
- Agent 创建后更新 sessionId

## 实现要点

1. ChatManager 从纯数据存储升级为业务管理层
2. Agent 增加 getCwd/getSessionId 方法
3. 移除 SessionManager 所有引用
4. handler 直接使用 chatManager 单例
5. 保持 claude/ 目录只包含 AI 相关模块

## 影响范围

**修改文件**：
- `src/bot/chat-manager.ts` - 合并 SessionManager 逻辑
- `src/claude/agent.ts` - 增加 getCwd/getSessionId
- `src/handlers/message.handler.ts` - 改用 chatManager
- `src/index.ts` - 简化启动流程

**删除文件**：
- `src/claude/session-manager.ts`

**不变文件**：
- `src/claude/bridge.ts`
- `src/claude/launcher.ts`
- `src/claude/types.ts`
- `src/services/message.service.ts`

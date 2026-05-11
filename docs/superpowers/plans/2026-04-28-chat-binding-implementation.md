# Chat Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为飞书群增加持久化目录绑定与基于 `open_id` 的访问控制。

**Architecture:** 新增本地 JSON 绑定仓库和纯函数访问策略；`ChatManager` 负责消费绑定仓库作为群默认目录，消息入口先做 `open_id` 和绑定状态校验，再继续原有命令与会话逻辑。

**Tech Stack:** TypeScript, Node.js fs/path, ts-node 测试脚本

---

### Task 1: 绑定存储与访问策略

**Files:**
- Create: `src/bot/chat-binding-store.ts`
- Create: `src/bot/chat-access.ts`
- Test: `tests/chat-binding.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖绑定文件读写、访问策略分支。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx ts-node tests/chat-binding.test.ts`

- [ ] **Step 3: 实现最小存储与策略**

支持读取、写入、更新绑定；支持授权 / 未授权 / 未绑定分支判定。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npx ts-node tests/chat-binding.test.ts`

### Task 2: 接入 ChatManager 和消息入口

**Files:**
- Modify: `src/config/index.ts`
- Modify: `src/bot/chat-manager.ts`
- Modify: `src/handlers/message.handler.ts`
- Test: `tests/chat-binding.test.ts`

- [ ] **Step 1: 扩展失败测试**

覆盖 `ChatManager` 持久化读取和 `/cd` 更新绑定后的行为。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx ts-node tests/chat-binding.test.ts`

- [ ] **Step 3: 实现最小接线**

将绑定仓库接入 `ChatManager` 和消息处理入口。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npx ts-node tests/chat-binding.test.ts`

### Task 3: 文档与验证

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新说明**

补充 `FEISHU_ALLOWED_OPEN_IDS` 和群绑定行为说明。

- [ ] **Step 2: 运行完整验证**

Run: `npx ts-node tests/chat-binding.test.ts`
Run: `npm run build`


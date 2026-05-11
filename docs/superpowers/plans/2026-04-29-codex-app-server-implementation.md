# Codex app-server Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 Codex 底层从 vendored `codex exec` wrapper 替换为 `codex app-server`，保留单 session 多轮对话、并发保护和中断语义，但不实现历史恢复链路。

**Architecture:** 保留 `CodexMinimalSession` 作为对上层的稳定外观，在 `src/codex-minimal/` 下新增 `app-server` 进程层和 JSON-RPC 层，由 session 负责 `initialize -> thread/start -> turn/start -> turn/interrupt` 生命周期。上层仅做最小接线调整，明确 Codex 基础版不支持 `/resume` 和跨进程恢复。

**Tech Stack:** TypeScript, Node.js child_process/readline, JSON-RPC 2.0 over stdio, ts-node script tests

---

### Task 1: 固定启动契约并完成协议探针

**Files:**
- Create: `tests/codex-launch-config.test.ts`
- Create: `tests/codex-app-server-smoke.ts`
- Modify: `src/codex/launch.ts`
- Modify: `package.json`

- [ ] **Step 1: 写 `launch.ts` 的失败测试**

创建 `tests/codex-launch-config.test.ts`，覆盖两条最小契约：

```ts
process.env.CODEX_CMD = "";
const { resolveCodexLaunchConfig } = require("../src/codex/launch");
const config = resolveCodexLaunchConfig();
assert.equal(config.executablePath, "codex");
assert.deepEqual(config.argsPrefix, []);
```

同时加一条 `CODEX_CMD` override 断言：

```ts
process.env.CODEX_CMD = "C:\\tools\\codex.cmd";
assert.equal(resolveCodexLaunchConfig().executablePath, "C:\\tools\\codex.cmd");
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx ts-node tests/codex-launch-config.test.ts`

Expected: 在 Windows 上断言失败，因为当前实现仍返回 `node codex.js` + `argsPrefix`。

- [ ] **Step 3: 将 Codex 启动契约改成直接运行 `codex`**

修改 `src/codex/launch.ts`：

- 保留 `CODEX_CMD` override
- 默认返回 `executablePath: "codex"`
- `argsPrefix` 固定为空数组
- 移除对 `APPDATA` / `codex.js` 路径推导的依赖

- [ ] **Step 4: 重新运行启动契约测试**

Run: `npx ts-node tests/codex-launch-config.test.ts`

Expected: PASS

- [ ] **Step 5: 写最小协议探针脚本**

创建 `tests/codex-app-server-smoke.ts`，脚本直接：

1. 调用 `resolveCodexLaunchConfig()`
2. `spawn(executablePath, ["app-server"])`
3. 通过 stdin 发送：
   - `initialize`
   - `initialized`
   - `thread/start`
   - `turn/start`
4. 从 stdout 逐行读取 JSON，确认：
   - 输出是逐行 JSONL
   - 至少收到一个成功 response
   - 能拿到 `threadId`
   - 能收到 `turn/completed`

脚本失败时要把 stderr 打印出来，避免只看到超时。
同时必须加入最小 server request handling：

- 收到带 `id + method` 的 JSON-RPC server request 时
- 对审批类 request 返回最小可接受 response
- 对未知 request 至少返回空对象并打印 method

探针的目标不是完整实现业务逻辑，而是确认“直接运行 `codex app-server` 时，客户端不能只读 notification”这一协议前提。

- [ ] **Step 6: 将协议探针接到脚本入口**

在 `package.json` 增加：

```json
"test:codex-app-server-smoke": "ts-node tests/codex-app-server-smoke.ts"
```

- [ ] **Step 7: 运行协议探针并确认通过**

Run: `npm run test:codex-app-server-smoke`

Expected: PASS，输出明确说明：

- `codex app-server` 可直接启动
- 默认 transport 可通过 stdio 完成最小握手
- stdout 为逐行 JSON

- [ ] **Step 8: 提交**

```bash
git add src/codex/launch.ts package.json tests/codex-launch-config.test.ts tests/codex-app-server-smoke.ts
git commit -m "test: [ts] add codex app-server launch probes"
```

### Task 2: 实现 app-server 进程层与 JSON-RPC 层

**Files:**
- Create: `src/codex-minimal/app-server-process.ts`
- Create: `src/codex-minimal/app-server-rpc.ts`
- Create: `src/codex-minimal/app-server-types.ts`
- Create: `tests/codex-app-server-rpc.test.ts`

- [ ] **Step 1: 写 RPC 层失败测试**

创建 `tests/codex-app-server-rpc.test.ts`，用 fake stdin / fake line input 覆盖最小协议行为：

```ts
c.handleLine('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
assert.deepEqual(await pending, { ok: true });
```

再覆盖这些分支：

- response error 能带出 method 名称
- `turn/started` 能记录 `turnId`
- `turn/completed(status=failed)` 能记录真实错误
- 顶层 `error(willRetry=true)` 不覆盖最终错误
- 非当前 `threadId` 的 notification 被忽略
- server request 自动返回 accept / 空对象

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx ts-node tests/codex-app-server-rpc.test.ts`

Expected: FAIL，因为 `app-server-rpc.ts` 尚不存在。

- [ ] **Step 3: 实现最小类型定义**

在 `src/codex-minimal/app-server-types.ts` 里只声明当前实现真正会用到的最小类型：

- request / response 基本 shape
- `turn/started`
- `turn/completed`
- `item/completed`
- `error`
- server request ids

不要把整份 schema vendoring 进仓库。

- [ ] **Step 4: 实现进程层**

在 `src/codex-minimal/app-server-process.ts` 中实现：

- 启动 `codex app-server`
- 暴露 `stdin`、按行读取 stdout、stderr tail
- `start() / stop() / onExit()`
- 在 stop 时确保关闭 stdin 并等待子进程退出

stderr tail 语义要参考 spec，而不是只做日志打印。

- [ ] **Step 5: 实现 RPC 层**

在 `src/codex-minimal/app-server-rpc.ts` 中实现：

- `request(method, params)`
- `notify(method, params?)`
- pending request map
- `handleLine()`
- `handleResponse()`
- `handleNotification()`
- `handleServerRequest()`

自动批准策略只覆盖当前基础版需要的请求：

- 命令执行审批
- 文件变更 / patch 审批

其余未知 server request 先返回空对象，并记日志。

- [ ] **Step 6: 重新运行 RPC 测试**

Run: `npx ts-node tests/codex-app-server-rpc.test.ts`

Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/codex-minimal/app-server-process.ts src/codex-minimal/app-server-rpc.ts src/codex-minimal/app-server-types.ts tests/codex-app-server-rpc.test.ts
git commit -m "feat: [ts] add codex app-server rpc transport"
```

### Task 3: 将 `CodexMinimalSession` 改为 app-server 状态机

**Files:**
- Modify: `src/codex-minimal/session.ts`
- Modify: `src/codex-minimal/verify.ts`

- [ ] **Step 1: 先把 `verify.ts` 改成基础版验收用例**

在 `src/codex-minimal/verify.ts` 中移除 vendored SDK 校验，改为这组断言：

- 首轮消息成功
- 非 Git 目录可运行
- 同一 session 阻止并发 turn
- `interrupt()` 使当前 turn 变成 `TurnAbortedError`
- 中断后同一 `threadId` 仍可继续下一轮
- `onActivity` 至少会在主线程 `turn/*` / `item/*` 事件上触发
- stderr 输出不会触发 `onActivity`
- 非当前 `threadId` 事件不会触发 `onActivity`

保留现有 `withTimeout()` / `captureError()` 之类的辅助逻辑。

- [ ] **Step 2: 运行 verify 并确认失败**

Run: `npm run verify:codex-minimal`

Expected: FAIL，因为当前 `session.ts` 仍依赖 vendored SDK / `AbortController` 终止模型。

- [ ] **Step 3: 重写 `CodexMinimalSession`**

在 `src/codex-minimal/session.ts` 中：

- 移除对 `loader.ts` / vendored SDK 的依赖
- 内部持有：
  - `AppServerProcess`
  - `AppServerRpcClient`
  - `threadId`
  - `activeTurnId`
  - session state
- 新增显式关闭入口，例如 `close()` 或 `destroy()`
- 首轮懒启动完成：
  - `initialize`
  - `initialized`
  - `thread/start`
- `sendMessage()` 内部改为：
  - 构造 `turn/start`
  - 等待当前 turn 的最终 `agentMessage`
  - 在 `turn/completed` 上收尾
- `interrupt()` 改为：
  - 仅在有活动 `turnId` 时发送 `turn/interrupt`
  - 不再依赖 `AbortController.abort()` 杀本地 promise

watchdog 兼容规则按 spec 实现：

- `turn/start` 前主动触发一次 `onActivity`
- 收到当前主线程的 `turn/*` / `item/*` 触发 `onActivity`
- stderr 不算 activity

错误策略也按 spec 实现：

- 启动前失败可冷启动重试一次
- turn 开始后失败不自动重放
- 进程退出时把 session 标为 `broken`
- `close()` / `destroy()` 时显式关闭 stdin 并等待 `app-server` 退出

- [ ] **Step 4: 运行 verify 并确认通过**

Run: `npm run verify:codex-minimal`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/codex-minimal/session.ts src/codex-minimal/verify.ts
git commit -m "feat: [ts] run codex minimal session via app-server"
```

### Task 4: 调整上层 Codex 恢复语义

**Files:**
- Modify: `src/codex/agent.ts`
- Modify: `src/bot/chat-manager.ts`
- Modify: `src/handlers/message.handler.ts`
- Create: `tests/codex-resume-disabled.test.ts`

- [ ] **Step 1: 写恢复降级的失败测试**

创建 `tests/codex-resume-disabled.test.ts`，最少覆盖：

```ts
const manager = new ChatManager({ defaultProvider: "codex", ... });
assert.equal(manager.supportsSessionResume("oc_test"), false);
```

再补两条行为断言：

- Codex help 文案显示 `/resume - 当前 agent 暂不支持`
- 切换到 Codex provider 后，`/cd` 成功不会再弹出 Codex session 列表

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx ts-node tests/codex-resume-disabled.test.ts`

Expected: FAIL，因为当前 `supportsSessionResume()` 仍把 `codex` 视为支持恢复。

- [ ] **Step 3: 改上层接线**

修改 `src/codex/agent.ts`：

- 构造 `CodexMinimalSession` 时不再把 `resumeSessionId` 当成有效能力宣传
- 日志里的 `resumeSupported` 改成准确值
- `destroy()` 时显式关闭 session 持有的 `app-server` 进程，而不只是 `interrupt()`

修改 `src/bot/chat-manager.ts`：

- `supportsSessionResume()` 对 Codex 返回 `false`
- 创建 Codex agent 时不要再向底层传恢复承诺
- 保持 Claude 路径不变

修改 `src/handlers/message.handler.ts`：

- help 文案跟随 `supportsSessionResume()`
- `switchCwd()` 里只在真正支持恢复的 provider 上展示 session 列表

- [ ] **Step 4: 重新运行恢复降级测试**

Run: `npx ts-node tests/codex-resume-disabled.test.ts`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/codex/agent.ts src/bot/chat-manager.ts src/handlers/message.handler.ts tests/codex-resume-disabled.test.ts
git commit -m "feat: [ts] disable codex resume for app-server baseline"
```

### Task 5: 移除旧边界并做完整验证

**Files:**
- Delete: `src/codex-minimal/loader.ts`
- Modify: `src/codex-minimal/verify.ts`
- Modify: `package.json`

- [ ] **Step 1: 删除旧 vendored loader 边界**

移除 `src/codex-minimal/loader.ts`，并确认仓库内不再有对以下旧入口的引用：

- `loadCodexSdk`
- `getVendoredSdkEntryPath`
- `startThread() / resumeThread()` 的 vendored wrapper 类型

用搜索确认：

Run: `rg -n "loadCodexSdk|getVendoredSdkEntryPath|vendor/codex-sdk-minimal|startThread\\(|resumeThread\\(" src tests`

Expected: 不再出现旧 `codex-minimal` vendored 入口的有效引用

- [ ] **Step 2: 校对脚本入口**

确认 `package.json` 至少包含这些可运行入口：

- `verify:codex-minimal`
- `test:codex-app-server-smoke`

不要顺手修 unrelated 的旧测试脚本命名问题，除非它们直接阻塞本任务。

- [ ] **Step 3: 运行完整验证**

Run: `npm run build`

Expected: TypeScript 编译通过

Run: `npx ts-node tests/codex-launch-config.test.ts`

Expected: PASS

Run: `npx ts-node tests/codex-app-server-rpc.test.ts`

Expected: PASS

Run: `npx ts-node tests/codex-resume-disabled.test.ts`

Expected: PASS

Run: `npm run test:codex-app-server-smoke`

Expected: PASS

Run: `npm run verify:codex-minimal`

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add package.json src/codex-minimal/verify.ts src/codex-minimal/session.ts src/codex-minimal/app-server-process.ts src/codex-minimal/app-server-rpc.ts src/codex-minimal/app-server-types.ts src/codex/launch.ts src/codex/agent.ts src/bot/chat-manager.ts src/handlers/message.handler.ts tests/codex-launch-config.test.ts tests/codex-app-server-smoke.ts tests/codex-app-server-rpc.test.ts tests/codex-resume-disabled.test.ts
git rm src/codex-minimal/loader.ts
git commit -m "feat: [ts] switch codex minimal runtime to app-server"
```

### Task 6: 人工 smoke 与收尾

**Files:**
- No planned file changes

- [ ] **Step 1: 启动本地 bot 做人工验证**

Run: `npm run build`

Run: `npm run start`

- [ ] **Step 2: 在真实聊天链路验证最小行为**

验证：

- 普通短消息能返回结果
- 长任务执行中 `/stop` 能打断
- 打断后下一条消息还能继续
- Codex help 中 `/resume` 显示为不支持
- 退出 bot 后没有残留的 `codex app-server` 子进程

- [ ] **Step 3: 若人工 smoke 发现问题，回到对应任务修复后重复验证**

- [ ] **Step 4: 提交最终收尾（如有额外修补）**

```bash
git add -A
git commit -m "fix: [ts] polish codex app-server rollout"
```

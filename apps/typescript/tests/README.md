# Claude Code CLI 测试用例

本目录包含 Claude Code CLI stdin/stdout 通信协议的测试用例。

## 测试列表

### 1. 基础通信测试 (stdio-protocol.test.ts) ✅

测试最基本的 stdin/stdout 通信流程。

**运行命令：**
```bash
npm run test:stdio
```

**测试内容：**
- 启动 CLI 进程
- 发送 control_request (initialize)
- 发送单条用户消息
- 接收 AI 响应

**测试状态：** ✅ 通过

---

### 2. 连续对话测试 (multi-turn.test.ts) ✅

测试在同一会话中进行多轮对话。

**运行命令：**
```bash
npm run test:multi-turn
```

**测试内容：**
- 在同一个 session 中发送 3 条消息
- 验证 AI 能记住上下文
- 测试消息队列处理

**测试状态：** ✅ 通过 - AI 能够引用之前的对话内容，session_id 保持一致

---

### 3. 工具权限自动批准测试 (tool-permission.test.ts) ⚠️

测试 AI 调用工具时的权限请求和自动批准流程。

**运行命令：**
```bash
npm run test:tool-permission
```

**测试内容：**
- 发送需要使用工具的请求
- 监听 control_request (can_use_tool)
- 自动发送 control_response (approved: true)
- 验证工具执行成功

**测试状态：** ⚠️ 待验证 - AI 可能直接使用已有知识而不调用工具，需要调整测试场景

---

### 4. 多 Session 管理测试 (multi-session.test.ts) ⚠️

测试按目录分组管理多个独立 session 的功能。

**运行命令：**
```bash
npm run test:multi-session
```

**测试内容：**
- 在目录 A 创建 session_A，让 AI 记住数字 42
- 在目录 B 创建 session_B，让 AI 记住数字 99
- 在目录 A 使用 --continue 恢复 session_A，验证记住的是 42
- 在目录 B 使用 --continue 恢复 session_B，验证记住的是 99

**实际场景：**
对应飞书的 `/cd` 命令：
- `/cd` 的本质是**按目录分组管理多个独立的 session**
- 每个目录有自己的 session，上下文互不影响
- 用户在目录 A 对话 → 使用 session_A
- 用户执行 `/cd /path/to/B` → 切换到 session_B（如果不存在则创建）
- 用户再执行 `/cd /path/to/A` → 切换回 session_A（恢复之前的上下文）

**测试状态：** ⚠️ 部分通过
- ✅ 不同目录可以创建独立的 session
- ✅ 使用 `--continue` 可以恢复对应目录的 session
- ✅ session_id 匹配正确
- ⚠️ AI 在恢复会话后没有输出响应内容（需要在实际场景中验证）

---

### 5. 工具调用测试 (tool-use.test.ts) 📝

测试 AI 调用工具的场景（如 Bash、Read 等）。

**运行命令：**
```bash
npm run test:tool-use
```

**测试内容：**
- 发送需要使用工具的请求
- 监听 tool_use 消息
- 统计工具调用次数

**测试状态：** 📝 参考实现 - 可作为监听 tool_use 消息的示例

---

## 测试架构

所有测试都遵循相同的架构：

```typescript
1. 启动 CLI 进程
   ├─ 清除 CLAUDECODE 环境变量
   ├─ 配置 stdio: ['pipe', 'pipe', 'pipe']
   └─ 使用 readline 解析 NDJSON 输出

2. 初始化流程
   ├─ 发送 control_request (initialize)
   └─ 等待 control_response

3. 消息处理
   ├─ 解析 JSON 消息
   ├─ 根据 type 分发处理
   └─ 处理错误和超时

4. 清理退出
   ├─ 关闭 stdin
   ├─ 关闭 readline
   └─ 退出进程
```

## 消息类型

测试中会遇到的主要消息类型：

| 类型 | 方向 | 说明 |
|------|------|------|
| `control_request` | → CLI | 初始化请求 |
| `control_response` | ← CLI | 初始化响应 |
| `user` | → CLI | 用户消息 |
| `system` | ← CLI | 系统消息（init, hook 等） |
| `assistant` | ← CLI | AI 响应（流式） |
| `tool_use` | ← CLI | 工具调用 |
| `result` | ← CLI | 任务完成 |

## 添加新测试

创建新测试的步骤：

1. 在 `tests/` 目录创建 `*.test.ts` 文件
2. 复制现有测试的基础结构
3. 修改测试消息和验证逻辑
4. 在 `package.json` 添加 npm 脚本
5. 更新本文档

## 注意事项

- 所有测试都设置了 30-60 秒的超时保护
- 测试会自动清理环境变量避免嵌套调用
- Windows 平台需要通过 `cmd.exe` 启动
- 使用 TypeScript 确保类型安全

## 参考文档

- [STDIO_PROTOCOL.md](../docs/STDIO_PROTOCOL.md) - 完整的协议文档
- [Python SDK](../../claude-agent-sdk-python/) - 官方实现参考

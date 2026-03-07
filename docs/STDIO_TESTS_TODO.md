# stdio 模式测试待办清单

## 已完成的测试

- ✅ 基础通信协议（stdio-protocol.test.ts）- 测试通过
- ✅ 多轮对话（multi-turn.test.ts）- 测试通过
- ⚠️ 工具权限自动批准测试（tool-permission.test.ts）- 已实现，待验证
- ⚠️ 多 Session 管理测试（multi-session.test.ts）- 已重写，待验证
- 📝 工具调用测试（tool-use.test.ts）- 参考实现

---

## 测试状态说明

### ✅ 基础通信协议
- 成功启动 CLI 进程
- 正确发送 control_request (initialize)
- 正确接收 control_response
- 成功发送用户消息并接收响应

### ✅ 多轮对话
- 在同一 session 中发送 3 条消息
- AI 能够引用之前的对话内容
- session_id 保持一致

### ⚠️ 工具权限自动批准
**问题**：AI 可能直接使用已有知识而不调用工具
**原因**：在 `--print` 模式下，AI 可能有项目上下文
**待解决**：
- 需要找到能强制触发工具调用的场景
- 或者验证在实际飞书场景中是否会收到权限请求

### ⚠️ 工作目录切换（多 Session 管理）
**测试状态**：部分通过

**已验证**：
- ✅ 不同目录可以创建独立的 session
- ✅ 使用 `--continue` 可以恢复对应目录的 session
- ✅ session_id 匹配正确（阶段 3 和 4 都恢复了正确的 session）

**待验证**：
- ⚠️ AI 在恢复会话后没有输出响应内容
- 可能是因为 `--continue` 在 `--print` 模式下的行为不同
- 需要在实际飞书场景中验证上下文是否正确恢复

**测试结果**：
- 阶段 1-2：成功创建两个独立的 session
- 阶段 3-4：成功恢复对应的 session_id，但 AI 响应为空

**结论**：
- 多 session 管理的基础功能（创建、恢复）工作正常
- 需要在实际使用场景中验证上下文恢复是否完整

---

## 待补充的测试

### 1. 工具权限自动批准测试 ⭐⭐⭐

**优先级**：高（迁移前必须完成）

**测试场景**：
- 发送需要工具调用的消息（如"请读取当前目录下的 package.json 文件"）
- 验证收到 `control_request` (can_use_tool)
- 验证自动发送 `control_response` (allow)
- 验证工具执行成功并返回结果

**重要性**：飞书机器人的核心功能，必须验证自动批准流程正确

**文件名**：`tests/tool-permission.test.ts`

---

### 2. 工作目录切换测试（多 Session 管理）⭐⭐⭐

**优先级**：高（迁移前必须完成）

**正确理解**：
- `/cd` 命令的本质是**按目录分组管理多个独立的 session**
- 每个目录有自己的 session，上下文互不影响
- 不存在"同一个 session 在不同目录恢复"的情况

**测试场景**：
1. 在目录 A 启动 CLI，创建 session_A，发送 "记住数字 42"
2. 在目录 B 启动 CLI，创建 session_B，发送 "记住数字 99"
3. 在目录 A 使用 `--continue` 恢复 session_A，询问 "我让你记住的数字是多少？"（应该回答 42）
4. 在目录 B 使用 `--continue` 恢复 session_B，询问 "我让你记住的数字是多少？"（应该回答 99）

**验证目标**：
- 验证不同目录的 session 完全独立
- 验证 `--continue` 能正确恢复对应目录的 session
- 验证上下文不会混淆

**重要性**：对应飞书的 `/cd` 命令，多工作目录管理的核心功能

**文件名**：`tests/multi-session.test.ts`（需要重写）

---

### 3. 进程异常退出处理测试 ⭐⭐

**优先级**：中（迁移后补充）

**测试场景**：
- 启动进程后立即 kill (SIGTERM)
- 验证 bridge 能检测到进程退出
- 验证不会尝试向已关闭的 stdin 写入
- 验证能正确清理资源（readline、事件监听器等）

**重要性**：健壮性保证，防止资源泄漏

**文件名**：`tests/process-crash.test.ts`

---

### 4. 并发消息处理测试 ⭐⭐

**优先级**：中（迁移后补充）

**测试场景**：
- 不等待第一条消息完成，立即发送第二条
- 验证消息不会丢失
- 验证响应顺序正确
- 验证不会出现竞态条件

**重要性**：飞书可能有并发消息，需要验证队列机制

**文件名**：`tests/concurrent-messages.test.ts`

---

### 5. 长消息处理测试 ⭐

**优先级**：低（稳定后补充）

**测试场景**：
- 发送超长内容（如 10000+ 字符）
- 验证 stdin 能正确写入
- 验证 stdout 能正确读取
- 验证不会因为缓冲区满而卡死

**重要性**：边界情况，防止缓冲区问题

**文件名**：`tests/long-message.test.ts`

---

### 6. 初始化超时测试 ⭐

**优先级**：低（稳定后补充）

**测试场景**：
- CLI 启动后长时间不响应
- 或者 initialize 后长时间无响应
- 验证超时检测机制
- 验证能正确报错并清理

**重要性**：健壮性保证，防止进程挂起

**文件名**：`tests/init-timeout.test.ts`

---

## 测试执行计划

### 阶段 1：迁移前验证（必须完成）
1. 工具权限自动批准测试
2. 工作目录切换测试

**目标**：确保 stdio 模式能完全替代 WebSocket 模式的核心功能

---

### 阶段 2：迁移后补充（建议完成）
3. 进程异常退出处理测试
4. 并发消息处理测试

**目标**：提高系统健壮性，处理异常场景

---

### 阶段 3：稳定后优化（可选）
5. 长消息处理测试
6. 初始化超时测试

**目标**：覆盖边界情况，提升用户体验

---

## 测试运行方式

```bash
# 运行所有测试
npm run test:stdio

# 运行单个测试
npx ts-node tests/tool-permission.test.ts
```

---

## 注意事项

1. 所有测试都需要清除 `CLAUDECODE` 环境变量
2. 使用 `--print --verbose --input-format stream-json --output-format stream-json` 参数
3. 使用 readline 逐行解析 NDJSON 输出
4. 设置合理的超时时间（建议 30-60 秒）
5. 测试完成后正确清理资源（stdin.end(), rl.close(), process.exit()）

---

## 参考文档

- [stdio 协议文档](./STDIO_PROTOCOL.md)
- [Python SDK 分析](./PYTHON_SDK_ANALYSIS.md)
- [WebSocket 协议文档](./WEBSOCKET_PROTOCOL_REVERSED.md)

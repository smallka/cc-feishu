# CLI 权限处理规则与设计原则

本文档总结 Claude Code CLI 对权限请求的处理规则，以及我们在实现交互式权限时的设计原则。

## CLI 权限处理规则

### 1. 阻塞机制

**规则：CLI 发送 `control_request` 后会完全阻塞**

- CLI 发送 `control_request { subtype: "can_use_tool" }`
- CLI 内部执行流程停止，等待 `control_response`
- 在收到响应前：
  - ✅ stdin 仍然可以接收数据（操作系统管道层面）
  - ❌ CLI 不会处理新的 `user` 消息
  - ❌ CLI 不会发送新的 `control_request`
  - ❌ CLI 不会发送 `assistant` 或 `result` 消息

**关键结论：单个 CLI 进程同时最多只有 1 个待处理的权限请求**

### 2. 超时行为

**规则：如果服务端不响应，CLI 会无限期阻塞**

- 没有内置超时机制
- CLI 可以发送 `control_cancel_request` 取消自己的请求（但我们未实现）
- 如果连接关闭，所有待处理请求会被拒绝

**关键结论：超时控制必须由服务端实现（我们的 PendingPermissions）**

### 3. 响应格式

**规则：必须返回 `control_response`，包含 `behavior` 和 `updatedInput`**

批准：
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "...",
    "response": {
      "behavior": "allow",
      "updatedInput": { /* 原始 input 或修改后的 */ }
    }
  }
}
```

拒绝：
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "...",
    "response": {
      "behavior": "deny",
      "message": "拒绝原因"
    }
  }
}
```

**关键结论：`updatedInput` 是必需的（批准时），必须从原始请求中获取**

### 4. 消息顺序

**规则：权限响应前后的消息顺序是严格的**

正常流程：
```
1. user 消息
2. assistant 消息（可能多个）
3. control_request (can_use_tool)
   [CLI 阻塞]
4. control_response (allow/deny)
   [CLI 继续]
5. assistant 消息（工具执行结果）
6. result 消息
```

**关键结论：在步骤 3-4 之间，不应该发送新的 `user` 消息，否则行为未定义**

### 5. requestId 唯一性

**规则：requestId 由 CLI 生成，是 UUID**

- 全局唯一（UUID v4）
- 用于匹配请求和响应
- 不会重复

**关键结论：可以用 requestId 作为全局标识符，不需要额外的 agentId 关联**

### 6. 进程生命周期

**规则：CLI 进程死亡后，所有待处理请求失效**

- 进程退出时，stdin/stdout 关闭
- 无法再发送 `control_response`
- 尝试写入会失败（EPIPE 错误）

**关键结论：发送响应前必须检查进程是否存活**

### 7. 协议违规行为

**规则：以下行为可能导致 CLI 异常**

- 在等待 `control_response` 时发送新的 `user` 消息
- 发送错误格式的 `control_response`
- 响应不存在的 `request_id`
- 重复响应同一个 `request_id`

**关键结论：必须在应用层防止这些违规行为**

---

## 设计原则：简单 + 兜底

在实现交互式权限时，我们遵循以下核心原则：

### 原则 1：让用户感知异常

**不要在底层默默处理错误，而是让用户知道发生了什么。**

✅ 好的做法：
```
用户：读取文件 A
系统：[等待权限]
用户：读取文件 B
系统：⚠️ 有待处理的权限请求，请先批准/拒绝，或使用 /new 重置会话
```

❌ 坏的做法：
```
用户：读取文件 A
系统：[等待权限]
用户：读取文件 B
系统：[默默丢弃消息 B，用户不知道发生了什么]
```

### 原则 2：提供兜底命令

**用户应该能够通过简单的命令解决任何卡住的状态。**

核心兜底命令：
- `/new` - 重置会话，清理所有状态
- `/stop` - 打断当前任务（如果支持）

这意味着：
- 不需要在每一层都实现复杂的清理逻辑
- 不需要处理所有边界情况
- 依赖用户的主动操作来恢复

### 原则 3：避免逐层加码

**不要在每一层都添加复杂的错误处理和状态管理。**

❌ 过度设计：
```
Bridge 层：
  - 追踪所有 pending requests
  - 实现 AbortController
  - 监听进程退出事件
  - 清理所有状态

Agent 层：
  - 追踪 pending permission
  - 注册清理回调
  - 实现 onDestroy 钩子
  - 清理 Bridge 状态

ChatManager 层：
  - 追踪所有 chat 的状态
  - 按 agentId 清理权限
  - 实现复杂的生命周期管理
```

✅ 简单设计：
```
Bridge 层：
  - 保存 pending request（用于获取 updatedInput）
  - 检查进程是否存活
  - 静默失败（如果进程已死）

Agent 层：
  - 一个 boolean 标记：hasPendingPermission
  - destroy() 时自动清理

ChatManager 层：
  - 检查 agent.hasPendingPermission()
  - 提示用户使用 /new
  - 依赖超时自动清理（5 分钟）
```

### 原则 4：依赖自然清理机制

**利用现有的清理机制，而不是实现新的。**

自然清理机制：
1. **超时清理**：PendingPermissions 的 5 分钟超时
2. **GC 清理**：Agent 销毁后，对象自动被垃圾回收
3. **进程检查**：发送响应前检查进程是否存活
4. **用户命令**：`/new` 重置所有状态

不需要的清理：
- ❌ Agent 销毁时主动清理 PendingPermissions
- ❌ 实现 AbortController 中止等待
- ❌ 按 agentId 过滤和清理
- ❌ 复杂的回调清理机制

### 原则 5：最坏情况可接受

**评估"完全不处理"的最坏情况，如果可接受，就不处理。**

示例分析：

| 场景 | 不处理的后果 | 是否可接受 | 决策 |
|------|-------------|-----------|------|
| Agent 销毁后用户点批准 | 响应发送失败（静默） | ✅ 可接受 | 不处理 |
| 权限请求超时 | 5 分钟后自动拒绝 | ✅ 可接受 | 不处理 |
| 内存泄漏（pending request） | 最多 5 分钟，约 1KB | ✅ 可接受 | 不处理 |
| 用户发新消息被阻止 | 用户不知道为什么 | ❌ 不可接受 | **必须处理** |
| CLI 进程崩溃 | 用户不知道状态 | ❌ 不可接受 | **必须处理** |

---

## 参考

- [PROTOCOL_SPEC.md](./PROTOCOL_SPEC.md) - 完整的 CLI 协议规范

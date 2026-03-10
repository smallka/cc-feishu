# Session 变化通知功能

## 概述

Python 版现已实现与 TypeScript 版对等的 session 变化检测和用户通知功能。

## 功能说明

### 通知场景

| 场景 | 条件 | 通知消息 |
|------|------|----------|
| **首次创建会话** | `expected_session_id = None` | 🆕 新会话: /path (session-id) |
| **恢复失败** | `actual_session_id != expected_session_id` | ⚠️ 恢复失败，已创建新会话: /path (session-id) |
| **恢复成功** | `actual_session_id == expected_session_id` | 无通知（静默） |

### 实现原理

```python
# 1. 创建 Agent 时记录期望值
agent, expected_session_id = self.get_or_create_agent(chat_id)

# 2. 包装回调，首次响应时检查变化
async def wrapped_response(response_text: str):
    if not chat_data.get('session_notified', False):
        actual_session_id = agent.get_session_id()
        session_changed = actual_session_id != expected_session_id

        # 3. 根据场景发送通知
        if not expected_session_id:
            notification = f'🆕 新会话: {cwd} ({actual_session_id})'
        elif session_changed:
            notification = f'⚠️ 恢复失败，已创建新会话: {cwd} ({actual_session_id})'

        # 4. 标记已通知，避免重复
        self.chats[chat_id]['session_notified'] = True

    await on_response(response_text)
```

## 数据结构变化

### ChatManager.chats

```python
# 旧版
self.chats: Dict[str, dict] = {}  # chat_id -> {cwd, session_id}

# 新版
self.chats: Dict[str, dict] = {}  # chat_id -> {cwd, session_id, session_notified}
```

### get_or_create_agent() 返回值

```python
# 旧版
def get_or_create_agent(self, chat_id: str) -> Agent

# 新版
def get_or_create_agent(self, chat_id: str) -> tuple[Agent, str | None]
```

## 测试

运行测试：

```bash
python test_session_notification.py
```

测试覆盖：
1. ✅ 首次创建会话（发送通知）
2. ✅ 第二次消息（不重复通知）
3. ✅ 恢复失败（发送警告通知）

## 用户体验改进

### 改进前

```
用户: 你好
AI: [响应内容]
```

用户不知道：
- 是新会话还是恢复的会话
- 恢复是否成功
- 当前 session ID

### 改进后

**场景 1：首次创建**
```
用户: 你好
系统: 🆕 新会话: /work/project (abc123...)
AI: [响应内容]
```

**场景 2：恢复失败**
```
用户: 继续之前的工作
系统: ⚠️ 恢复失败，已创建新会话: /work/project (xyz789...)
AI: [响应内容]
```

**场景 3：恢复成功**
```
用户: 继续之前的工作
AI: [响应内容，包含历史上下文]
```

## 与 TypeScript 版对比

| 功能 | Python 版 | TypeScript 版 | 状态 |
|------|-----------|---------------|------|
| **检测 session 变化** | ✅ | ✅ | 对等 |
| **首次创建通知** | ✅ | ✅ | 对等 |
| **恢复失败通知** | ✅ | ✅ | 对等 |
| **避免重复通知** | ✅ | ✅ | 对等 |
| **区分场景** | ✅ | ✅ | 对等 |

## 相关文件

- `src/bot/chat_manager.py` - 核心实现
- `test_session_notification.py` - 单元测试
- `docs/SESSION_NOTIFICATION.md` - 本文档

## 后续优化

可选的增强功能：

1. **Session 摘要**：显示会话创建时间、消息数量
2. **恢复提示**：提供 `/sessions` 命令查看历史会话
3. **自动清理**：定期清理过期的 session 记录

## 提交记录

```
commit f8aee27
feat: 添加 session 变化自动通知功能

实现与 TypeScript 版对等的 session 变化检测和用户通知
```

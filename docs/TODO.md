# TODO

## P1 - 尽快处理

- [ ] 收敛 `message_handler` 和 `ChatManager` 之间的内部耦合。
  说明：`message_handler` 还直接访问 `chat_manager.chats`、调用 `_get_session_list()` 这类内部实现，后续重构会比较脆；应该补公开接口，例如 `resolve_resume_target()`、`get_chat_state()`。
  涉及文件：[src/handlers/message_handler.py](/C:/work/cc-feishu/src/handlers/message_handler.py)、[src/bot/chat_manager.py](/C:/work/cc-feishu/src/bot/chat_manager.py)

- [ ] 拆分 `message_handler` 的命令分发逻辑。
  说明：现在所有命令和普通消息转发都堆在一个函数里，已经偏长，后面继续加命令会降低可读性和可测试性。
  涉及文件：[src/handlers/message_handler.py](/C:/work/cc-feishu/src/handlers/message_handler.py)

- [ ] 为消息处理补状态同步机制。
  说明：当前接口仍然是“入队后立即返回”，如果后续调用方需要明确知道 Claude 已完成处理，需要单独补一个等待完成或事件通知机制。
  涉及文件：[src/bot/chat_manager.py](/C:/work/cc-feishu/src/bot/chat_manager.py)、[src/claude/agent.py](/C:/work/cc-feishu/src/claude/agent.py)

## P2 - 后续优化

- [ ] 减少模块级初始化副作用。
  说明：`config` 和 `feishu_client` 在 import 时就初始化，会增加测试配置成本，也不利于后续做依赖注入和多环境切换。
  涉及文件：[src/config/__init__.py](/C:/work/cc-feishu/src/config/__init__.py)、[src/bot/client.py](/C:/work/cc-feishu/src/bot/client.py)

- [ ] 为 session 文件扫描和恢复逻辑补边界测试。
  说明：`~/.claude/projects` 的路径映射、空 session 过滤、跨目录恢复这些逻辑比较细，值得补针对性测试，避免后续回归。
  涉及文件：[src/bot/chat_manager.py](/C:/work/cc-feishu/src/bot/chat_manager.py)

- [ ] 梳理用户提示文案与命令帮助的一致性。
  说明：例如错误提示里仍有 `/ls` 表述，而实际命令是 `/resume`；这类细节会直接影响使用体验。
  涉及文件：[src/bot/chat_manager.py](/C:/work/cc-feishu/src/bot/chat_manager.py)、[src/handlers/message_handler.py](/C:/work/cc-feishu/src/handlers/message_handler.py)

- [ ] 清理未充分使用的日志封装。
  说明：`StructuredLogger` 现在基本没有实际接入，可以评估删除或统一接入，避免保留无效抽象。
  涉及文件：[src/utils/logger.py](/C:/work/cc-feishu/src/utils/logger.py)

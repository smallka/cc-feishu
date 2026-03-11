# TODO

## P1 - TypeScript Backport From Python

- [x] 恢复 TypeScript 版的 session 浏览与恢复能力。
  说明：Python 版已经支持 `/resume`、session 列表、编号恢复、跨目录恢复、空 session 过滤。TypeScript 版当前还没有对应命令和扫描流程。
  涉及文件：[chat_manager.py](/C:/work/cc-feishu/apps/python/src/bot/chat_manager.py)、[message_handler.py](/C:/work/cc-feishu/apps/python/src/handlers/message_handler.py)、[chat-manager.ts](/C:/work/cc-feishu/apps/typescript/src/bot/chat-manager.ts)、[message.handler.ts](/C:/work/cc-feishu/apps/typescript/src/handlers/message.handler.ts)

- [ ] 为 TypeScript Agent 增加串行消息队列。
  说明：Python 版 agent 已经用队列和后台任务保证同一 chat 的消息串行处理；TypeScript 版目前仍是直接调用 `agent.sendMessage()`，在 IM 场景下更容易出现重入和状态竞争。
  涉及文件：[agent.py](/C:/work/cc-feishu/apps/python/src/claude/agent.py)、[chat_manager.py](/C:/work/cc-feishu/apps/python/src/bot/chat_manager.py)、[agent.ts](/C:/work/cc-feishu/apps/typescript/src/claude/agent.ts)、[chat-manager.ts](/C:/work/cc-feishu/apps/typescript/src/bot/chat-manager.ts)

- [ ] 补齐 TypeScript 的 WebSocket 生命周期治理。
  说明：Python 版在后续提交里补了后台线程退出感知、显式 stop/disconnect、异常退出上抛和对应测试；TypeScript 版现在的 `stop()` 还只是清空引用。
  涉及文件：[websocket.py](/C:/work/cc-feishu/apps/python/src/bot/websocket.py)、[test_websocket.py](/C:/work/cc-feishu/apps/python/tests/test_websocket.py)、[websocket.ts](/C:/work/cc-feishu/apps/typescript/src/bot/websocket.ts)

- [ ] 把 TypeScript 的业务层测试补到 Python 版的粒度。
  说明：Python 版已经有 agent、chat manager、message handler、session notification、websocket 生命周期测试；TypeScript 版测试仍然偏协议和脚本级，缺少业务层回归保护。
  涉及文件：[apps/python/tests](/C:/work/cc-feishu/apps/python/tests)、[apps/typescript/tests](/C:/work/cc-feishu/apps/typescript/tests)、[tests/README.md](/C:/work/cc-feishu/apps/typescript/tests/README.md)

- [ ] 细化 TypeScript 的中断、超时和销毁错误语义。
  说明：Python 版对 `interrupt/reset/switch_cwd/stop` 做了更细的结果区分和超时保护；TypeScript 版当前的返回值和错误提示更粗。
  涉及文件：[chat_manager.py](/C:/work/cc-feishu/apps/python/src/bot/chat_manager.py)、[message_handler.py](/C:/work/cc-feishu/apps/python/src/handlers/message_handler.py)、[chat-manager.ts](/C:/work/cc-feishu/apps/typescript/src/bot/chat-manager.ts)、[message.handler.ts](/C:/work/cc-feishu/apps/typescript/src/handlers/message.handler.ts)

## P1 - Python Cleanup

- [ ] 收敛 `message_handler` 与 `ChatManager` 的内部耦合。
  说明：`message_handler` 仍直接访问 `chat_manager.chats`、调用 `_get_session_list()` 这类内部实现；后续继续演进时会比较脆，应补公开接口。
  涉及文件：[message_handler.py](/C:/work/cc-feishu/apps/python/src/handlers/message_handler.py)、[chat_manager.py](/C:/work/cc-feishu/apps/python/src/bot/chat_manager.py)

- [ ] 拆分 Python `message_handler` 的命令分发逻辑。
  说明：命令处理和普通消息转发都堆在一个函数里，继续加命令会影响可读性和可测试性。
  涉及文件：[message_handler.py](/C:/work/cc-feishu/apps/python/src/handlers/message_handler.py)

- [ ] 为 Python 消息处理补完成态同步机制。
  说明：当前接口仍然是“入队后立即返回”。如果后续调用方需要明确知道 agent 已完成处理，需要单独补等待完成或事件通知机制。
  涉及文件：[chat_manager.py](/C:/work/cc-feishu/apps/python/src/bot/chat_manager.py)、[agent.py](/C:/work/cc-feishu/apps/python/src/claude/agent.py)

## P2 - Later Cleanup

- [ ] 减少 Python 模块级初始化副作用。
  说明：`config` 和 `feishu_client` 仍然在 import 时初始化，不利于后续依赖注入和多环境切换。
  涉及文件：[__init__.py](/C:/work/cc-feishu/apps/python/src/config/__init__.py)、[client.py](/C:/work/cc-feishu/apps/python/src/bot/client.py)

- [ ] 为 Python session 扫描与恢复逻辑补边界测试。
  说明：`~/.claude/projects` 的路径映射、空 session 过滤、跨目录恢复等逻辑比较细，值得单独补回归测试。
  涉及文件：[chat_manager.py](/C:/work/cc-feishu/apps/python/src/bot/chat_manager.py)

- [ ] 统一用户提示文案和帮助命令。
  说明：目前两套实现的命令帮助和错误提示已经开始分叉，后续如果继续并行维护，最好抽一份对齐清单。
  涉及文件：[message_handler.py](/C:/work/cc-feishu/apps/python/src/handlers/message_handler.py)、[message.handler.ts](/C:/work/cc-feishu/apps/typescript/src/handlers/message.handler.ts)

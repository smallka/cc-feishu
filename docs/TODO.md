# TODO

## TypeScript App

### P0 - 当前明确问题

- [ ] 修复 `message.handler.ts` 中未定义的 `timeout` 变量。
  说明：`handleMessageInternal()` 末尾直接使用 `timeout` 做慢请求日志判断，但当前函数内并未定义该变量，属于当前代码层面的明确错误。
  涉及文件：[message.handler.ts](/C:/work/cc-feishu/src/handlers/message.handler.ts)

- [ ] 修复消息 reaction 清理与实际完成请求错位的问题。
  说明：当前用全局 FIFO 队列配合 `onResponseComplete()` 移除 reaction。只要多个 chat 并发、完成顺序变化，或中途超时/报错，就可能移除错消息的 reaction，或者残留未清理的 reaction。
  涉及文件：[message.handler.ts](/C:/work/cc-feishu/src/handlers/message.handler.ts)、[chat-manager.ts](/C:/work/cc-feishu/src/bot/chat-manager.ts)

- [x] 修复 session 路径编码不可逆的问题。
  说明：TypeScript 版 session 扫描已改为直接从 transcript 读取 `cwd` 元数据，不再反解 `~/.claude/projects/<sanitized-cwd>` 目录名；同时补了回归测试，覆盖包含 `-` 的目录名场景，避免 `/resume <编号>` 切到错误目录。
  涉及文件：[session-scanner.ts](/C:/work/cc-feishu/src/claude/session-scanner.ts)、[session-scanner.test.ts](/C:/work/cc-feishu/tests/session-scanner.test.ts)

### P1 - 近期迭代重点

- [ ] 为 TypeScript Agent 增加串行消息队列。
  说明：历史 Python 版曾用队列和后台任务保证同一 chat 的消息串行处理；TypeScript 版目前仍是直接调用 `agent.sendMessage()`，在 IM 场景下更容易出现重入和状态竞争。历史经验已整理到 `docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md`。
  涉及文件：[agent.ts](/C:/work/cc-feishu/src/claude/agent.ts)、[chat-manager.ts](/C:/work/cc-feishu/src/bot/chat-manager.ts)

- [x] 恢复 TypeScript 版的 session 浏览与恢复能力。
  说明：TypeScript 版已补上 `/resume`、session 列表、编号恢复、跨目录恢复、空 session 过滤等流程，但还需要继续验证恢复语义和回归风险。
  涉及文件：[chat-manager.ts](/C:/work/cc-feishu/src/bot/chat-manager.ts)、[message.handler.ts](/C:/work/cc-feishu/src/handlers/message.handler.ts)

- [ ] 补齐 TypeScript 的 WebSocket 生命周期治理。
  说明：TypeScript 版现在的 `stop()` 还只是清空引用，不是真正关闭连接；需要补充连接关闭、异常退出上抛和对应回归验证。
  涉及文件：[websocket.ts](/C:/work/cc-feishu/src/bot/websocket.ts)

- [ ] 细化 TypeScript 的中断、超时和销毁错误语义。
  说明：TypeScript 版当前对 `interrupt/reset/switch_cwd/stop` 的返回值和错误提示较粗，需要补充结果区分和超时保护。
  涉及文件：[chat-manager.ts](/C:/work/cc-feishu/src/bot/chat-manager.ts)、[message.handler.ts](/C:/work/cc-feishu/src/handlers/message.handler.ts)

### P2 - 工程整理

- [ ] 校正 TypeScript 测试脚本、测试文件名和依赖。
  说明：`package.json` 里的测试脚本引用的是 `*.test.ts`，仓库里实际文件是 `tests/*.ts`；同时当前 devDependencies 没有 `ts-node`，测试入口和文档状态不一致。
  涉及文件：[package.json](/C:/work/cc-feishu/package.json)、[tests/README.md](/C:/work/cc-feishu/tests/README.md)、[tests](/C:/work/cc-feishu/tests)

- [ ] 降低 TypeScript 模块级初始化副作用，给后续测试和重构腾空间。
  说明：`config` 缺少 Feishu 凭证时会在 import 阶段直接抛错，`client` 和 `messageService` 也都是导入即初始化的单例，不利于 mock、依赖注入和分层测试。
  涉及文件：[index.ts](/C:/work/cc-feishu/src/config/index.ts)、[client.ts](/C:/work/cc-feishu/src/bot/client.ts)、[message.service.ts](/C:/work/cc-feishu/src/services/message.service.ts)

- [ ] 按当前迭代方向补充 TypeScript 回归测试，而不是追求覆盖率。
  说明：后续测试应围绕正在改动的会话语义、命令分发或 Agent 生命周期来设计，作为阶段性变更保护；不需要机械对齐 Python 的全部测试粒度，也不要求所有用例长期保留。
  涉及文件：[tests](/C:/work/cc-feishu/tests)、[chat-manager.ts](/C:/work/cc-feishu/src/bot/chat-manager.ts)、[message.handler.ts](/C:/work/cc-feishu/src/handlers/message.handler.ts)、[agent.ts](/C:/work/cc-feishu/src/claude/agent.ts)


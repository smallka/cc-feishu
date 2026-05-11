# Python 与 TypeScript 运行时边界备忘

本文用于在删除 Python 历史实现后，保留少量仍有参考价值的差异判断。

范围只包含由语言或平台导致、且对实现影响很大、不能简单替换的差异。本文不比较两套实现的业务功能多少，也不记录迁移期间的临时缺口。

## 选择标准

仅保留满足以下条件的差异：

- 会影响核心架构或关键抽象。
- 迁移时不能靠改包名、改 import 或少量语法替换完成。
- 会改变错误处理、资源生命周期、并发控制或协议桥接方式。
- 处理不当会导致长连接断线、会话泄漏、消息乱序、子进程悬挂或输出解析错误。

## 总结

Python 到 TypeScript 的差异不应理解成“同一个模块换一种语言重写”。真正高风险的部分集中在运行时边界：

- 长连接消息如何进入异步调度系统。
- SDK 如何暴露事件、错误和流式结果。
- bot 作为常驻服务如何被启动、监控和重启。
- 本地 Agent 或 CLI 如何通过子进程和 stdio 被可靠桥接。

这些边界决定系统如何持续运行。迁移或删除 Python 版时，应把它们视为运行时适配层的设计问题，而不是逐文件翻译问题。

## 异步模型

Python 版围绕 `asyncio` 组织控制流。典型形态包括 `async def` handler、`await` SDK 调用、`asyncio.Queue`、后台 `Task`、`async for` 消费流式响应，以及通过 task cancellation 终止长任务。

TypeScript/Node.js 版围绕 event loop、Promise、stream 和 EventEmitter 组织控制流。典型形态包括 Promise-based handler、SDK 事件注册、stdout/stderr stream 事件、`readline` 行读取、显式 pending turn 状态，以及通过进程控制或协议消息中断任务。

不能简单替换的原因：

- 取消语义不同。`asyncio.CancelledError`、SDK interrupt、Node 进程 kill、协议 interrupt 不是等价概念。
- 异常传播不同。Python 后台 task 需要显式观察异常；Node 侧则要同时处理 Promise rejection、stream error 和 child process exit。
- 流式响应模型不同。Python 可通过 async iterator 消费 SDK message；Node 侧常需要把 stdout 行事件解析成协议消息。
- 同一 chat/session 的串行化策略需要重新设计。Python 可自然落在 `asyncio.Queue` 上，Node 侧需要明确 pending turn、队列或拒绝并发的策略。

后续参考重点：

- 消息进入 Agent 前是否按 chat/session 串行。
- 后台任务异常是否会被观察并上报。
- interrupt、timeout、destroy 是否有清晰且互不混淆的结果语义。
- 长连接回调和 Agent 响应回调是否会跨线程或跨事件循环。

## SDK 形态

Python 版使用 `lark-oapi` 和 `claude-agent-sdk`。其中 Agent 侧可以通过 SDK client 建立连接、发送 query，并以消息对象流的形式接收 `AssistantMessage`、`ResultMessage` 等结果。

TypeScript 版使用 `@larksuiteoapi/node-sdk`，Agent 侧则存在本地 Claude/Codex bridge、minimal app-server、vendor/minimal SDK 等运行时适配代码。它更常见的边界是 Node child process、stdio、NDJSON 或 RPC 风格消息。

不能简单替换的原因：

- SDK 事件模型不同。注册回调、回调返回值、异常处理和自动重连策略都可能不同。
- 错误对象不同。异常、错误返回值、SDK 包装错误和进程退出码需要分别映射。
- 流式接口不同。async iterator、callback、Readable stream、NDJSON line protocol 需要不同 adapter。
- 鉴权和 client 初始化不同。token、app secret、domain、logger、auto reconnect 等配置不一定能逐项平移。

后续参考重点：

- handler 层应依赖本地 adapter，而不是直接散落 SDK 对象结构。
- SDK 错误需要归一化成业务可理解的错误类型。
- 流式响应应明确 completion 信号，不能只依赖“收到文本”判断完成。
- 测试 mock 应贴近 SDK 暴露形态，而不是只模拟最终文本。

## 进程管理

Python 版可由解释器直接启动，也有脚本负责互斥锁、清理旧实例、再启动 `python -m src.main`。它的生产托管可以交给外部 supervisor，但当前历史实现里也包含 Python 侧的进程探测和锁文件逻辑。

TypeScript/Node.js 版当前更偏向 build 后运行 `dist/index.js`，并通过 PM2 配置常驻进程、日志、重启、最小运行时间和 kill timeout。Node + PM2 在 Windows 上还存在额外兼容问题，例如进程探活依赖和 `wmic` 相关风险。

不能简单替换的原因：

- 启动入口不同。Python 源码即入口，TypeScript 需要处理 `src` 与 `dist` 的路径差异。
- supervisor 行为不同。脚本级互斥、PM2 autorestart、Windows taskkill、Node signal 处理不是同一套语义。
- 日志和环境变量加载时机不同。`.env`、工作目录、build 产物路径和 PM2 cwd 都会影响运行时行为。
- 退出语义不同。正常 stop、异常 exit、启动失败、重启风暴需要被区分记录。

后续参考重点：

- 明确唯一常驻入口，避免同时存在脚本互斥和 PM2 多套治理。
- 明确运行目录和配置加载目录。
- build 后路径不能假定等同源码路径。
- Windows 上的 stop/kill 流程要单独验证。

## 子进程和 CLI 集成

Python 侧可以通过 SDK 或 `asyncio.subprocess` 风格处理 CLI，整体更容易落入 coroutine、async iterator 和 task cancellation 模型。

TypeScript/Node.js 侧通过 `child_process.spawn`、stdin/stdout/stderr stream、`readline`、Promise 和显式状态机桥接 CLI。当前实现中 Claude bridge 通过 stdout 行读取 NDJSON，Codex minimal app-server 也需要管理子进程生命周期、stderr tail、Windows `taskkill` 和 stop timeout。

这是最不能简单替换的一层。需要单独设计：

- 如何启动 CLI，并传入 cwd、model、permission、resume session 等参数。
- 如何写入用户消息、control response、interrupt 等协议消息。
- 如何读取 stdout/stderr，并区分结构化事件、普通文本和错误输出。
- 如何处理半包、粘包、多行 JSON、空行、非协议日志和 UTF-8 编码。
- 如何识别 init、assistant、result、tool/control request、keep alive、exit。
- 如何取消正在运行的 turn，并清理 pending promise、回调和 session 状态。
- 如何在进程退出时区分用户主动销毁、CLI 异常退出和 stop timeout。

后续参考重点：

- 协议 parser、session 状态机和进程生命周期应分层。
- stderr 应保留 tail，便于进程异常退出后定位原因。
- pending turn 必须在 result、detach、destroy、exit 和 timeout 路径上被 resolve 或 reject。
- 中断和销毁应可重复调用，并且不会留下悬挂 Promise。
- 测试应覆盖真实子进程或足够接近的 fake process，而不是只测纯函数。

## 删除 Python 版后的保留价值

删除 Python 目录后，可以保留的不是 Python 结构本身，而是这些运行时边界上的经验：

- Python 版的队列化 Agent 处理可作为“同一 chat/session 串行化”的参考。
- Python 版 WebSocket 线程与主事件循环衔接可作为“跨运行时回调调度”的反例或参考。
- Python 版 SDK 消息流可帮助判断 TypeScript adapter 需要暴露哪些稳定事件。
- Python 版启动脚本可提醒后续不要忽视单实例、旧进程清理和异常退出语义。

不应保留为迁移依据的内容：

- Python 目录结构。
- Python 启动命令和部署脚本。
- 仅因 Python SDK 形态产生的封装层。
- 当前迁移过程中两套实现的临时功能差异。

# Feishu Codex Prompt E2E

状态: completed

## 目标

- 新增一条显式 opt-in 的真实飞书 + Codex E2E。
- 验证 testbot 真实 Codex turn 能吃到飞书 Bot 交互环境 developer instructions。

## 范围

- 不纳入默认 `npm test`。
- 复用现有 testbot `lark-cli` API 级收发环境。
- 只发送一个短提示词语义探针，不测试文件上传或长任务。

## 实现

- 新增 `tests/feishu-e2e-utils.ts`，共享 testbot `lark-cli` 鉴权、发消息、读消息和轮询逻辑。
- 保留 `tests/feishu-api-e2e.ts` 的 `/stat` 快速链路，并改为复用共享工具。
- 新增 `tests/feishu-codex-prompt-e2e.ts`：
  - 先发送 `/new`，确保新 Codex 会话。
  - 再发送带唯一 `E2E_MARKER` 的短 prompt。
  - 等待 bot 回复同时包含 marker、飞书/Bot 交互语义和终端不可见语义。
- 新增 `npm run test:e2e:feishu-codex-prompt`。

## 验证

- `npm run build` 通过。
- `pm2 restart cc-feishu-ts-testbot` 后，testbot 使用最新构建运行。
- `npm run test:e2e:feishu` 通过，确认真实飞书收发链路仍正常。
- `npm run test:e2e:feishu-codex-prompt` 通过；真实回复包含：
  - `E2E_MARKER: cc-feishu-prompt-e2e-1779337735977-17389d89`
  - `我当前通过飞书 Bot 与用户沟通；用户不一定能看到本地终端或桌面 UI。`

## 剩余风险

- 该 E2E 依赖真实 Codex turn，耗时、额度、外部进程和模型输出都会带来波动，因此保持显式 opt-in。
- 断言只覆盖关键语义，不断言完整文本；如果提示词措辞或模型表达变化，可能需要更新匹配规则。


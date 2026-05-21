# Feishu API E2E

状态: completed

## 目标

- 新增一条显式 opt-in 的飞书 API 级 E2E 验证链路。
- 使用 testbot 所属飞书应用，通过真实飞书 API 向测试群发送 `/stat`。
- 通过真实飞书 API 读取测试群消息，确认 bot 返回状态信息。

## 范围

- 新增 E2E 脚本和 npm script，不纳入默认 `npm test`。
- 记录 testbot 专用 `lark-cli` 配置目录的初始化方式。
- 不做飞书网页版或桌面客户端自动化。
- 不触发真实 Codex/Claude 模型 turn。

## 实现

- 新增 `tests/feishu-api-e2e.ts`：
  - 要求显式配置 `FEISHU_E2E_CHAT_ID` 和 `LARKSUITE_CLI_CONFIG_DIR`。
  - 通过 `lark-cli auth status --verify` 确认用户身份可用。
  - 通过 `lark-cli auth check --scope ...` 检查发消息和读群消息所需的用户授权。
  - 用用户身份发送真实 `/stat` 到测试群。
  - 用用户身份轮询 `im +chat-messages-list`，匹配非当前用户发送且包含 `Provider:` 的 bot 回复。
- 新增 `npm run test:e2e:feishu`，保持默认 `npm test` 不触发真实飞书收发。
- 更新 `INSTALL.md`，记录 testbot 专用 `lark-cli` 配置目录和运行方式。
- 将 `.lark-cli-testbot/` 加入 `.gitignore`，避免提交本地 CLI 配置。
- 修正 `src/lark-cli/drive-upload-capability.ts` 的 `auth status/check` 参数：当前 `lark-cli` 这两个子命令默认输出 JSON，但不接受 `--format json`。

## 验证

- `npm run build` 通过。
- `npm test` 通过。
- `node -r ts-node/register tests/lark-drive-upload-capability.test.ts` 通过。
- 未配置 `FEISHU_E2E_CHAT_ID` / `LARKSUITE_CLI_CONFIG_DIR` 时执行 `npm run test:e2e:feishu`，脚本提前失败并提示缺少显式环境变量，未发送真实飞书消息。
- 使用 testbot 专用 `.lark-cli-testbot` 配置和群 `testbot` 的 `FEISHU_E2E_CHAT_ID` 执行 `npm run test:e2e:feishu` 通过；脚本发送 `/stat`，并读回 bot 回复：
  - `当前没有活跃会话`
  - `Provider: codex`
  - `工作目录: C:\work`

## 剩余风险

- 第一版匹配 `/stat` 回复依赖内容包含 `Provider:`；如果状态输出格式未来改变，需要同步更新 E2E 判定。
- API 级 E2E 只能覆盖真实飞书 OpenAPI 和长连接事件链路，不覆盖飞书桌面端或网页版 UI 行为。

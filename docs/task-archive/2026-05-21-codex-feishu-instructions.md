# Codex Feishu Instructions

- 状态: completed
- 日期: 2026-05-21

## 目标

为 Codex app-server 新建会话预设一段 developer instructions，让 agent 知道当前交互来自飞书 Bot，而不是终端 TUI。

## 范围

- 增加 Codex developer instructions 配置，提供保守默认值和环境变量覆盖能力。
- 新建 Codex thread 时传入 developer instructions。
- 保持 resume 旧会话行为不变，避免对历史 session 追加不确定上下文。

## 验证

- `npm run build`
- 相关单元测试或默认测试入口

## 结果

- 新增 `config.codex.developerInstructions`，默认提供飞书 Bot 交互上下文。
- 支持通过 `CODEX_DEVELOPER_INSTRUCTIONS` 覆盖；设置为空白字符串时禁用默认值。
- Codex 新建 thread 时通过 `thread/start.developerInstructions` 注入；resume 旧 thread 时不注入。

## 验证结果

- `npm run build` 通过。
- `npx ts-node tests/config.test.ts` 通过。
- `npx ts-node tests/codex-minimal-resume.test.ts` 通过。
- `npm test` 通过。

## 剩余风险

- 默认提示词正文仍待用户进一步细聊和调整。
- 已恢复的旧 Codex session 不会自动获得这段 developer instructions。

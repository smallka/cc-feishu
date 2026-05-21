# Codex Lark Drive Capability

- 状态: completed
- 日期: 2026-05-21

## 目标

将 Codex developer instructions 拆为基础飞书 Bot 环境提示和可选飞书云盘交付提示；云盘交付提示仅在新建 Codex thread 前探测到 `lark-cli` 具备上传能力时注入。

## 范围

- 增加全局复用的 `lark-cli` Drive 上传能力探测模块。
- 在 Codex 新建 thread 前异步解析 developer instructions。
- 保持 resume 旧 session 不注入新 instructions。
- 补充相关测试和文档。

## 验证

- `npm run build`
- 相关单元测试

## 结果

- 新增 `src/lark-cli/drive-upload-capability.ts`，通过 `lark-cli auth status --format json` 和 `lark-cli auth check --scope drive:file:upload --format json` 探测飞书云盘上传能力。
- 探测设置 2 秒超时；失败时仅 debug 记录并降级，不阻塞 Codex 会话启动。
- 新增 `src/codex/developer-instructions.ts`，基础飞书 Bot 上下文始终来自 `CODEX_DEVELOPER_INSTRUCTIONS` 或默认值；仅探测到上传能力时追加飞书云盘交付提示。
- `CodexMinimalSession` 改为支持异步 `developerInstructionsProvider`，并仅在新建 thread 时注入；resume thread 不注入。

## 验证结果

- `npm run build` 通过。
- `npx ts-node tests/lark-drive-upload-capability.test.ts` 通过。
- `npx ts-node tests/codex-developer-instructions.test.ts` 通过。
- `npx ts-node tests/config.test.ts` 通过。
- `npx ts-node tests/codex-minimal-resume.test.ts` 通过。
- `npx ts-node tests/codex-agent.test.ts` 通过。
- `npm test` 通过。

## 剩余风险

- 当前版本每次新建 Codex session 都会探测一次 `lark-cli`，最多增加约 2-4 秒启动延迟；失败会降级为只注入基础提示。
- 只检查 auth status 和 scope，不执行真实上传 dry-run；实际上传仍可能因文件、网络或飞书权限细节失败。
- 已 resume 的旧 Codex session 不会自动获得新增提示词。

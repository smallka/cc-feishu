# T0008 - Converge Test Entrypoints

Started: 2026-05-11
Archived: 2026-05-11
Status: validated

## Scope

用户要求推进“收敛测试入口”。

本任务只收敛测试脚本、依赖声明和验证入口；不修改业务实现，不重写测试断言。

## Changes

- 新增 `npm run verify`，统一执行 `npm run build && npm test`。
- 新增 `npm test` / `npm run test:unit`，通过 `tests/run-unit-tests.js` 顺序运行所有 `tests/*.test.ts`。
- 将 `codex-app-server-smoke.ts` 暴露为 `test:smoke:codex-app-server`，并保留旧 `test:codex-app-server-smoke` 作为兼容别名。
- 将 Claude CLI 相关脚本归类为 `test:manual:*`，并保留旧脚本名作为兼容别名。
- 在 `devDependencies` 中直接声明 `ts-node`，并同步 `package-lock.json`。
- 更新 `docs/PROGRESS.md`，将默认验证入口改为 `npm run verify`。

## Validation

- `npm run verify`

Result: passed，仓库根目录执行成功。

## Evidence

- `npm run verify` 成功执行 `tsc`。
- `npm run verify` 成功执行全部 `tests/*.test.ts`，包括 chat binding、Codex app-server process/rpc、Codex minimal session、config、Feishu handler、session scanner、websocket dispatcher 等自动测试。

## Risks

- `codex-app-server-smoke.ts` 会启动真实 Codex app-server，仍保留为 smoke 入口，未纳入默认自动验证。
- `stdio-protocol.ts`、`multi-turn.ts`、`tool-use.ts`、`tool-permission.ts`、`multi-session.ts` 会启动 Claude CLI，归类为 manual 入口，未纳入默认自动验证。
- `npm install --package-lock-only` 报告 7 个既有 npm audit vulnerabilities；本任务未做依赖升级，避免扩大范围。

## Related Files

- `package.json`
- `package-lock.json`
- `tests/run-unit-tests.js`
- `docs/PROGRESS.md`

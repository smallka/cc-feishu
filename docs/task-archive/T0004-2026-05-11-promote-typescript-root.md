# T0004 - Promote TypeScript App To Repository Root

## Scope

- 将旧应用子目录下的 TypeScript 应用提升到仓库根目录。
- 删除迁移后的空 `apps/` 目录。
- 合并根 `README.md`、`.gitignore` 与应用级运行说明。
- 将原应用内 `docs/` 内容并入根 `docs/`。
- 更新 `AGENTS.md`、`docs/PROGRESS.md`、`docs/DECISIONS.md`、`docs/README.md`、`docs/TODO.md` 和当前维护说明中的路径。
- 保留历史任务归档中的旧路径作为当时证据，不回写旧任务记录。

## Validation

```powershell
Set-Location C:\work\cc-feishu
npm run build
```

Result: passed. `npm run build` completed `tsc` successfully from the repository root.

## Evidence

- `package.json`、`tsconfig.json`、`src/`、`tests/`、`vendor/`、`ecosystem.config.js` 和 `ecosystem.testbot.config.js` 已位于仓库根目录。
- `apps/` 目录已不存在。
- PM2 ecosystem 配置仍使用 `cwd: __dirname`，移动到仓库根后其工作目录随配置文件位置变为仓库根。
- 当前维护入口的默认验证命令已改为根目录执行 `npm run build`。

## Risks And Gaps

- 本任务未修复既有 TypeScript 业务问题或测试脚本依赖不一致。
- `logs/` 中的历史本地日志仍可能包含旧绝对路径；这些是忽略的运行产物，本任务未修改。
- 旧任务归档保留旧路径用于历史证据，不代表当前结构。

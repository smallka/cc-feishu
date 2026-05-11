# T0005 - Clean Root Promotion Residue

## Scope

- 清理 TypeScript 应用提升到仓库根后，当前维护文档中残留的旧应用目录表述。
- 更新迁移决策和迁移归档措辞，避免把旧目录表现为当前可用路径。
- 保留旧任务归档中的旧路径作为历史证据。

## Validation

```powershell
Set-Location C:\work\cc-feishu
npm run build
```

Result: passed. `npm run build` completed `tsc` successfully from the repository root.

## Evidence

- 当前维护入口扫描已无旧应用目录引用：`AGENTS.md`、`README.md`、`INSTALL.md`、`CLAUDE.md`、`TODO.md`、`docs/README.md`、`docs/TODO.md`、`docs/PROGRESS.md`、`docs/DECISIONS.md` 和 T0004 归档不再包含旧应用目录路径。
- 全仓扫描剩余旧路径只出现在 T0001-T0003 历史任务归档中，作为当时验证命令和历史事实保留。

## Risks And Gaps

- 本任务未删除 `.env`、`data/`、`logs/`、`tmp/`、`dist/` 或 `node_modules/` 等本地运行状态和构建产物。
- 本任务未修复 TypeScript 业务问题或测试脚本依赖不一致。

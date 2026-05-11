# T0001 - Agent Harness Init

- Started：2026-05-11
- Archived：2026-05-11
- Status：validated

## Scope

- 将根 `AGENTS.md` 改造为 agent harness 入口。
- 新增 `docs/PROGRESS.md` 记录当前状态、主线方向和默认验证入口。
- 新增 `docs/DECISIONS.md` 记录长期决策。
- 新增 `docs/task-archive/README.md` 定义后续任务归档规则。

本任务不删除 Python 历史实现，不修复 `apps/python/CLAUDE.md`，不调整 TypeScript 测试脚本。

## Validation

```powershell
cd C:\work\cc-feishu\apps\typescript
npm run build
```

Result：passed。

## Evidence

- `npm run build` 执行 `tsc` 并成功退出。
- 轻量 harness 检查确认：
  - `AGENTS.md` 存在并指向 `docs/PROGRESS.md`
  - `docs/PROGRESS.md` 存在
  - `docs/DECISIONS.md` 存在
  - `docs/task-archive/README.md` 存在
  - WIP=1、验证命令、已验证工作单元、归档命名规则均已写明
  - 新增/修改的 harness 文档均可严格按 UTF-8 解码

## Risks

- TypeScript 测试脚本与依赖声明仍有已知不一致，本任务只记录风险，不修复测试矩阵。
- `apps/python/CLAUDE.md` 仍有编码损坏风险，但 Python 版已被记录为待删除历史实现，因此本任务不修复它。

## Related Files

- `AGENTS.md`
- `docs/PROGRESS.md`
- `docs/DECISIONS.md`
- `docs/task-archive/README.md`

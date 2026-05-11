# T0007 - Remove Docs README

Started: 2026-05-11
Archived: 2026-05-11
Status: validated

## Scope

用户补充确认不需要单独保留 `docs/README.md`。

本任务仅删除该目录级索引，并移除根 `README.md` 中指向它的链接。不重写历史任务归档中的旧证据文本。

## Changes

- 删除 `docs/README.md`。
- 从根 `README.md` 移除 `docs/README.md` 链接。
- 更新 `docs/PROGRESS.md` 记录当前任务状态和验证结果。

## Validation

- `npm run build`

Result: passed，仓库根目录执行 `tsc` 成功。

## Evidence

- 当前入口不再指向 `docs/README.md`。
- `rg` 扫描中剩余的 `docs/README.md` 提及只存在于历史任务归档或本任务进度记录中。

## Risks

- 删除后 `docs/` 不再有目录级索引；这是用户明确要求的文档收敛方向。

## Related Files

- `README.md`
- `docs/PROGRESS.md`
- `docs/README.md`

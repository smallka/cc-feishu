# T0002 - Runtime Boundary Notes

- Started：2026-05-11
- Archived：2026-05-11
- Status：validated

## Scope

- 新增 `docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md`，作为后续删除 Python 历史实现后的备忘参考。
- 文档范围收紧为语言或平台导致、对实现影响很大且不能简单替换的差异：
  - 异步模型
  - SDK 形态
  - 进程管理
  - 子进程和 CLI 集成
- 更新 `docs/PROGRESS.md`，记录本次文档任务状态。

本任务不删除 `apps/python/`，不修改 Python 或 TypeScript 源码，不比较两套实现的业务功能多少。

## Validation

```powershell
cd C:\work\cc-feishu\apps\typescript
npm run build
```

Result：passed。

## Evidence

- `docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md` 已按用户确认范围落盘。
- 文档明确排除了业务功能差异和迁移期间临时缺口。
- 文档保留运行时边界相关经验，供删除 Python 版后参考。
- `npm run build` 执行 `tsc` 并成功退出。

## Risks

- 文档基于当前仓库内 Python 历史实现和 TypeScript 主线实现整理；如果删除 Python 前又发生运行时边界改动，需要同步更新本文。
- TypeScript 测试脚本与依赖声明仍有已知不一致，本任务只运行默认 build 验证，不修复测试矩阵。

## Related Files

- `docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md`
- `docs/PROGRESS.md`

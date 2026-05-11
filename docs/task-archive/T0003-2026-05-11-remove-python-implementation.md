# T0003 - Remove Python Implementation

- Started：2026-05-11
- Archived：2026-05-11
- Status：validated

## Scope

- 删除 `apps/python/` 历史实现目录，包括 Python 源码、测试、安装文档、启动脚本和应用级配置样例。
- 更新根 `README.md`，将项目说明收敛为 TypeScript 单实现入口。
- 更新 `AGENTS.md`、`docs/README.md`、`docs/TODO.md`、`docs/DECISIONS.md` 和 `docs/plans/README.md`，去掉仍把 Python 版描述为当前可运行实现的维护说明。
- 将 `docs/PYTHON_SDK_ANALYSIS.md` 中指向已删除 `apps/python/CLAUDE.md` 的参考链接改为保留的运行时边界备忘文档。

本任务不迁移 `apps/typescript/` 到仓库根目录，不修复 TypeScript 业务问题，不修复测试脚本或依赖声明。

## Validation

```powershell
cd C:\work\cc-feishu\apps\typescript
npm run build
```

Result：passed。

## Evidence

- `apps/python/` 已从工作区删除，`apps/` 下只剩 `typescript/`。
- 根 README 的 quick start 只指向 `apps/typescript`。
- `docs/TODO.md` 已移除 Python App 后续任务，并将仍有参考价值的 Python 对照说明改为历史经验描述。
- `npm run build` 执行 `tsc` 并成功退出。

## Risks

- `docs/plans/` 和 `docs/task-archive/` 中仍保留历史路径引用，这是刻意保留历史证据，不代表当前仓库布局。
- `docs/PYTHON_SDK_ANALYSIS.md` 本身存在非 UTF-8 字节；本任务只做二进制安全的 ASCII 链接替换，未重写或修复整份历史文档编码。
- TypeScript 测试脚本与依赖声明仍有已知不一致，本任务只运行默认 build 验证。

## Related Files

- `README.md`
- `AGENTS.md`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`
- `docs/README.md`
- `docs/TODO.md`
- `docs/PYTHON_SDK_ANALYSIS.md`
- `docs/plans/README.md`
- `apps/python/`

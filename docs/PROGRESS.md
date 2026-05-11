# Progress

## 当前状态

- 当前阶段：从双实现仓库收敛为 TypeScript 单实现。
- 当前有效基线：`apps/typescript/` 是后续开发主线；`apps/python/` 是待删除历史实现。
- 默认验证命令：`cd apps/typescript && npm run build`
- 当前任务来源：`docs/TODO.md` 仍保留为既有任务池；当前活动任务以本文件为准。

## 当前任务

- 状态：validated
- 任务：生成 Python 与 TypeScript 运行时边界备忘文档，作为删除 Python 版后的参考。
- scope：`docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md`、`docs/PROGRESS.md`、`docs/task-archive/T0002-2026-05-11-runtime-boundary-notes.md`。
- 验证命令：`cd apps/typescript && npm run build`
- 当前观察项：本文档只记录由语言或平台导致、对实现影响很大且不能简单替换的运行时边界差异；不比较业务功能差异，也不执行 Python 删除。

## 下一任务

- 规划并执行 Python 目录删除。
- 同步更新根 README 和 docs 中的双实现描述。
- 清理或重定向对 `apps/python/`、`apps/python/CLAUDE.md` 的引用。
- 单独修复 TypeScript 测试脚本、测试文件名和依赖声明。

## 文档入口

- `AGENTS.md`
- `docs/DECISIONS.md`
- `docs/task-archive/`
- `docs/TODO.md`

# Progress

## 当前状态

- 当前阶段：TypeScript 单实现主线。
- 当前有效基线：TypeScript 应用位于仓库根目录；Python 历史实现已删除。
- 默认验证命令：`npm run build`
- 当前任务来源：用户要求清理目录提升后残留的旧应用目录引用。

## 当前任务

- 状态：validated
- 任务：清理 TypeScript 应用提升到仓库根后的目录引用残留。
- scope：当前维护文档、迁移决策、迁移归档和仓库文档入口中仍将旧应用目录表现为当前路径的表述。
- 验证命令：`npm run build`
- 验证结果：passed，`npm run build` 已在仓库根成功执行 `tsc`。
- 归档：`docs/task-archive/T0005-2026-05-11-clean-root-promotion-residue.md`
- 当前观察项：当前维护入口已不再包含旧应用目录路径；旧 T0001-T0003 任务归档中的旧路径作为历史证据保留。本任务不删除本地运行状态、构建产物或历史任务归档中的证据路径。

## 下一任务

- 单独修复 TypeScript 测试脚本、测试文件名和依赖声明。
- 根据 `docs/TODO.md` 继续处理 TypeScript P0/P1 问题。

## 文档入口

- `AGENTS.md`
- `docs/DECISIONS.md`
- `docs/task-archive/`
- `docs/TODO.md`

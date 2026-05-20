# Agent Guide

## 项目概览

本仓库是 TypeScript 飞书机器人实现；当前应用根目录就是仓库根目录。

- 仓库内当前源码、配置、测试和维护文档优先于外部笔记、旧导出、临时文件和仓库外引用。

## task 核心概念

task 是 agent 的单焦点工作单元，用来承载目标、范围、验证、证据和风险。

- 活动 task 放在 `docs/tasks/`；完成 task 归档到 `docs/task-archive/`。
- task 文件名使用 `YYYY-MM-DD-keywords.md`。
- task 状态使用 `pending`、`in_progress`、`completed`。
- task 创建时记录目标、范围和预期验证方式。
- task 以记录的验证方式通过作为完成标志；完成时记录验证结果、关键证据和剩余风险，并将 task 文件归档到 `docs/task-archive/`。

## 关键文档和目录

- `AGENTS.md`：项目级 agent 入口，只放高层规则和导航。
- `README.md`、`INSTALL.md`：面向使用和部署的当前说明。
- `docs/task-archive/`：完成 task 归档。
- `docs/pm2-win11-pidusage-fix.md`：仅在 Windows/PM2 部署或排障任务中读取。
- `docs/`：只沉淀当前有效且可复用的领域结论、规则、流程和约束；一次性过程、临时决策和完整验证输出写入 task 归档。

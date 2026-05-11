# Task Archive

本目录保存已完成、明确阻塞或被取消的任务记录。

新增任务归档默认按任务一文件保存，文件名格式为：

```text
TNNNN-YYYY-MM-DD-short-task-slug.md
```

- `TNNNN` 是全局递增任务编号，不按年月重置。
- `YYYY-MM-DD` 是任务归档日期，即任务达到验证通过、明确阻塞或被取消并写入归档的日期，不是任务创建日期。
- `short-task-slug` 使用简短、可检索的英文短语。

任务记录应包含：

- Scope
- Validation
- Evidence
- Risks
- Related commits or files

长任务可以在正文同时记录 `Started` 和 `Archived`。现有历史计划或报告不在本次初始化中自动迁移。

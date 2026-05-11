# cc-feishu

基于 TypeScript 的飞书机器人实现，使用 WebSocket 长连接接收消息，并将消息转发给本地 Agent 处理。

当前仓库已回到单实现结构，TypeScript 应用位于仓库根目录。

当前实现支持：

- 按飞书群持久化绑定固定工作目录
- 基于 `open_id` 白名单限制可操作用户
- 通过 `/cd <路径>` 在群内绑定或修改当前群的工作目录

## 快速开始

```bash
npm install
cp .env.example .env
npm run dev
```

首次使用前至少要配置：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_ALLOWED_OPEN_IDS`

未绑定目录的群不会进入普通对话，授权用户需要先执行 `/cd <路径>` 完成绑定。

## 生产运行（PM2）

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
```

常用命令：

- `pm2 status`
- `pm2 logs cc-feishu-ts`
- `pm2 restart cc-feishu-ts`

如果要在 worktree 中常驻运行独立测试 bot，使用：

```bash
npm run build
pm2 start ecosystem.testbot.config.js
pm2 save
```

- `pm2 logs cc-feishu-ts-testbot`
- `pm2 restart cc-feishu-ts-testbot`

## 主要目录

```text
src/      应用源码
tests/    测试与验证脚本
docs/     仓库级文档、历史计划、协议说明和 TypeScript 相关设计记录
vendor/   随仓库维护的最小依赖快照
```

- [`INSTALL.md`](./INSTALL.md) - 安装、配置与启动说明
- [`CLAUDE.md`](./CLAUDE.md) - 实现说明
- [`docs/pm2-win11-pidusage-fix.md`](./docs/pm2-win11-pidusage-fix.md) - PM2 在 Windows 11 下的 `wmic ENOENT` 修复记录
- [`docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md`](./docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md) - Python 历史实现与 TypeScript 当前实现的边界说明

## Notes

- 运行命令默认在仓库根目录执行，`.env`、PM2 `cwd` 和默认工作根都以仓库根目录为准。
- 历史 Python 实现已删除，不再作为新开发、验证或对照依据。

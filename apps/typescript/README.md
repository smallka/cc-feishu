# cc-feishu TypeScript 应用

基于 TypeScript 的飞书机器人实现，使用 WebSocket 长连接接收消息，并将消息转发给本地 Agent 处理。

当前实现支持：

- 按飞书群持久化绑定固定工作目录
- 基于 `open_id` 白名单限制可操作用户
- 通过 `/cd <路径>` 在群内绑定或修改当前群的工作目录

## 适用场景

适合以下情况：

- 需要使用原始的 Node.js / TypeScript 实现
- 运行环境已经对齐 `Node.js >= 18`
- 需要继续扩展 Codex 或 Claude 相关能力

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

- [`src`](./src) - 应用源码
- [`INSTALL.md`](./INSTALL.md) - 安装、配置与启动说明
- [`CLAUDE.md`](./CLAUDE.md) - 实现说明
- [`docs/pm2-win11-pidusage-fix.md`](./docs/pm2-win11-pidusage-fix.md) - PM2 在 Windows 11 下的 `wmic ENOENT` 修复记录
- [`docs`](./docs) - TypeScript 相关协议和设计文档

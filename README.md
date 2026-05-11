# cc-feishu

基于 TypeScript 的飞书机器人实现，使用 WebSocket 长连接接收消息，并将消息转发给本地 Agent 处理。

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

## 主要目录

```text
src/      应用源码
tests/    测试与验证脚本
docs/     仓库级文档和协议说明
vendor/   随仓库维护的最小依赖快照
```

- [`INSTALL.md`](./INSTALL.md) - 安装、配置与启动说明
- [`docs/README.md`](./docs/README.md) - 文档入口

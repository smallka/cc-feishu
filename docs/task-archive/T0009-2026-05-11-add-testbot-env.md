# T0009 - Add Testbot Environment File

Started: 2026-05-11
Archived: 2026-05-11
Status: validated

## Scope

用户要求直接创建测试环境真实配置文件，使测试环境与正式环境参数分离。

本任务只新增本地 `.env.testbot` 并记录验证结果；不新增模板文件，不修改业务代码。

## Changes

- 新增本地 `.env.testbot`，配置测试飞书应用的 `FEISHU_APP_ID` 与 `FEISHU_APP_SECRET`；真实值不提交。
- 测试环境使用从测试 bot 日志确认的 `FEISHU_ALLOWED_OPEN_IDS`。
- 测试环境使用默认工作目录 `C:\work`。
- 测试环境使用独立状态文件 `data/chat-bindings.test.json`。
- 测试环境使用独立单实例端口 `8653`，避免与正式环境默认端口 `8652` 冲突。
- 测试环境使用 `NODE_ENV=development`。

## Validation

- `npm run verify`
- `node -e "process.env.APP_ENV_FILE='.env.testbot'; const config=require('./dist/config').default; console.log(...)"`

Result: passed。

## Evidence

- `npm run verify` 成功执行 `tsc` 与全部 `tests/*.test.ts` 自动测试。
- 构建产物读取 `.env.testbot` 后确认：
  - app id 为测试应用配置值
  - allowlist 读取到测试 bot 日志中的真实 open_id 配置值
  - `AGENT_WORK_ROOT` 解析为 `C:\work`
  - `CHAT_BINDINGS_FILE` 解析为 `C:\work\cc-feishu\data\chat-bindings.test.json`
  - `SINGLE_INSTANCE_PORT` 解析为 `8653`
  - `NODE_ENV` 解析为 `development`

## Risks

- `.env.testbot` 包含真实密钥，依赖 `.gitignore` 防止提交；当前 git status 显示该文件为 ignored。
- 测试环境 open_id 来自 2026-05-11 21:28:53 的测试 bot `/stat` 拒绝日志；如后续要授权更多用户，需要继续追加到 `FEISHU_ALLOWED_OPEN_IDS`。真实 open_id 仅保存在本地 ignored 配置文件中。
- 未启动真实 PM2 测试 bot；本任务验证配置加载与自动测试，不验证飞书开放平台侧配置是否完整。

## Related Files

- `.env.testbot`
- `docs/PROGRESS.md`

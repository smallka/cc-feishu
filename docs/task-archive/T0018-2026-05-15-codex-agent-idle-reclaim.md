# T0018 - Codex Agent Idle Reclaim

## Scope

- Diagnose why background Codex app-server processes keep growing while PM2 itself stays healthy.
- Add Codex-only idle reclaim in `ChatManager` so each chat does not permanently retain a `CodexAgent` and its child app-server process.
- Preserve the Codex session id after idle reclaim so the next message can create a fresh agent with `resumeSessionId`.
- Avoid changing Claude runtime behavior.

## Findings

- `pm2 list` showed one healthy `cc-feishu-ts` process:
  - PM2 version: `6.0.14`
  - app process: `cc-feishu-ts`, version `1.0.0`, pid `3836`, status `online`, uptime `2D`, restarts `0`
- Windows process inspection showed 7 `cmd.exe /d /s /c codex app-server` root process chains under the PM2 app pid.
- Root cause: `ChatManager` cached one `CodexAgent` per chat indefinitely. Each `CodexAgent` owns a `CodexMinimalSession`, which owns one app-server process. Previously there was no idle TTL.

## Changed Files

- `src/agent/types.ts`
- `src/bot/chat-manager.ts`
- `src/codex/agent.ts`
- `src/config/index.ts`
- `tests/config.test.ts`
- `tests/chat-manager-idle-reclaim.test.ts`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`

## Behavior

- Codex agents are scheduled for idle reclaim after `AGENT_IDLE_TTL_MS`, defaulting to 30 minutes.
- Idle reclaim is provider-scoped: only `provider === 'codex'` uses the timer.
- If the agent reports a running turn at timer fire time, reclaim is deferred and checked again later.
- The current session id is retained in chat state before the agent is destroyed.
- The next message for that chat creates a new Codex agent with `resumeSessionId`.
- Claude files and runtime behavior are not changed.

## Validation

Commands:

```powershell
Set-Location C:\work\cc-feishu
node -r ts-node/register tests/chat-manager-idle-reclaim.test.ts
npm run build
npm run verify
```

Result: passed.

Evidence:

- `chat-manager-idle-reclaim.test.ts` passed and covers:
  - idle Codex agent destruction;
  - preserving session id and resuming on next message;
  - deferring reclaim while an agent reports a running turn;
  - cancelling a stale timer when another message arrives;
  - non-Codex providers do not schedule idle reclaim.
- `tsc` completed successfully.
- `npm run verify` completed successfully before the final display-only Codex/Claude scoping adjustment; targeted test and `npm run build` passed after that adjustment. A final full `npm run verify` was run again after docs were updated.

## Notes

- Existing PM2 and child processes were inspected but not restarted or killed.
- Existing live app-server children will not disappear until the deployed PM2 process runs this new code and those agents reach the idle TTL.
- Verification output still includes known noisy logs from existing tests:
  - Feishu token/reaction removal warnings from mocked test paths;
  - malformed JSON parse logs from `message-intake.test.ts`;
  - synthetic workload failure logs from `workload-queue-handler.test.ts`.

## Risk

- The behavior depends on `CodexMinimalSession.isRunning()` accurately reflecting an active turn. The test covers the `ChatManager` scheduling contract, not the full real app-server lifecycle.
- Current running PM2 process still uses old code until restarted.

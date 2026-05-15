# T0019 - Workday Session Decision

## Scope

- Add simple rule-based session selection before a normal chat message reaches an Agent.
- Do not introduce an extra agent/LLM to judge intent.
- Do not start, restart, reload, or kill the currently running PM2/testbot/production process.
- Preserve the existing command flow; explicit `/new` and `/resume` commands are still handled by command routing.

## Behavior

- Workday cutoff defaults to local `05:00`.
- Same workday with a known prior session or live agent continues the previous session.
- Cross workday starts a new session unless the message explicitly expresses continuation.
- Explicit new-session intent starts a new session regardless of date.
- If the user says "continue" but there is no known prior session or live agent, a new session is started and the user is told why.
- Every decision sends a short notice:
  - `继续使用上一个会话。`
  - `已跨作息日，未检测到继续意图，已新开会话。`
  - `检测到继续意图，沿用上一个会话。`
  - `检测到新开意图，已新开会话。`
  - `检测到继续意图，但当前没有可延续会话，已新开会话。`

## Changed Files

- `src/bot/session-decision.ts`
- `src/bot/chat-manager.ts`
- `src/config/index.ts`
- `tests/session-decision.test.ts`
- `tests/chat-manager-session-decision.test.ts`
- `tests/chat-manager-idle-reclaim.test.ts`
- `tests/codex-resume-enabled.test.ts`
- `tests/config.test.ts`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`

## Configuration

- `AGENT_SESSION_DAY_CUTOFF_HOUR`
  - default: `5`
  - valid range: `0` through `23`
  - meaning: subtract this many local hours before deriving the workday key, so early-morning messages before the cutoff still belong to the previous workday.

## Validation

Commands:

```powershell
Set-Location C:\work\cc-feishu
node -r ts-node/register tests/session-decision.test.ts
node -r ts-node/register tests/chat-manager-session-decision.test.ts
node -r ts-node/register tests/chat-manager-idle-reclaim.test.ts
node -r ts-node/register tests/codex-resume-enabled.test.ts
npm run verify
git diff --check
```

Result: passed.

Evidence:

- `session-decision.test.ts` covers:
  - midnight staying in the same workday before the `05:00` cutoff;
  - `05:00` cutoff starting a new workday;
  - explicit continue/new intent patterns;
  - the unavailable-continue fallback.
- `chat-manager-session-decision.test.ts` covers:
  - same-workday resume;
  - cross-workday new session;
  - cross-workday explicit continue;
  - same-workday explicit new session;
  - destroying an existing fake agent when a new session is chosen.
- Existing idle reclaim and resume tests still pass with session decision notifications injected as test no-ops.
- `npm run verify` completed successfully.
- `git diff --check` reported no whitespace errors.

## Notes

- No process startup test was needed, so testbot was not started.
- Existing PM2 and Codex app-server processes were not inspected, restarted, or modified in this task.
- Verification output still includes known noisy logs from existing tests:
  - Feishu token/reaction removal warnings from mocked test paths;
  - malformed JSON parse logs from `message-intake.test.ts`;
  - synthetic workload failure logs from `workload-queue-handler.test.ts`.

## Risk

- Intent detection is deliberately simple and rule-based. It may miss uncommon phrasings until more patterns are added.
- Session continuity is currently based on in-memory chat state and live agent state. If the process restarts, an unqualified "continue" without explicit `/resume` or a known chat session will start a new session.

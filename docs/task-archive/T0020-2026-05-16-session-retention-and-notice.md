# T0020 - Session Retention And Notice

## Scope

- Extend the default Codex Agent idle retention window.
- Reduce noisy session decision notices for the normal same-workday continue path.
- Keep the existing rule-based session selection behavior and explicit notices for meaningful context-boundary changes.
- Do not start, restart, reload, kill, or inspect the running PM2/testbot/production process.

## Behavior

- `AGENT_IDLE_TTL_MS` default changed from 30 minutes to 4 hours.
- `AGENT_IDLE_TTL_MS` still overrides the default and remains a positive integer in milliseconds.
- Same-workday default continuation still resumes the previous known session, but no longer sends `继续使用上一个会话。`.
- Notices are still sent for:
  - explicit continue intent;
  - explicit new-session intent;
  - continue intent when no previous session is known;
  - cross-workday new session without continue intent.

## Changed Files

- `src/config/index.ts`
- `src/bot/session-decision.ts`
- `src/bot/chat-manager.ts`
- `tests/config.test.ts`
- `tests/session-decision.test.ts`
- `tests/chat-manager-session-decision.test.ts`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`

## Validation

Commands:

```powershell
Set-Location C:\work\cc-feishu
npm run verify
git diff --check
```

Result: passed.

Evidence:

- `session-decision.test.ts` passed and now expects no notice for `same_workday`.
- `chat-manager-session-decision.test.ts` passed and now verifies same-workday resume is silent while other decision notices remain.
- `config.test.ts` passed and now verifies the default idle TTL is 4 hours.
- `npm run verify` completed successfully, including `tsc` and all unit tests.
- `git diff --check` reported no whitespace errors.

## Notes

- The change does not alter Claude provider reclaim behavior.
- Existing deployed PM2 process will keep using its current loaded config/code until restarted by the operator.
- Verification output still includes known noisy mocked-test logs around Feishu token/reaction cleanup, malformed intake JSON, synthetic media download failures, and synthetic workload failure.

## Risk

- A 4-hour default keeps Codex app-server children alive longer than the previous 30-minute default, trading more memory/process residency for fewer resume boundaries.
- Same-workday continuation is now silent, so users who want to inspect the current session should use `/stat` or session commands.

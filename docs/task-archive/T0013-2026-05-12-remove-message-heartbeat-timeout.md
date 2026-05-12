# T0013 - Remove message heartbeat and timeout notify

## Scope

- Remove queued message heartbeat timer notifications.
- Remove idle timeout notify/kill branch from queued message processing.
- Keep per-chat serial queue behavior.
- Keep active task progress for `/stat`.
- Keep `/new` clearing waiting queued messages and resetting the session.
- Keep `/stop` interrupt behavior unchanged.

## Changes

- Simplified `src/handlers/message.handler.ts` queued message execution from timer-based `Promise.race` orchestration to direct task execution with active progress tracking.
- Removed heartbeat and idle timeout formatting/helpers and related constants.
- Kept `activeTaskProgress` updates so `/stat` can still report phase, recent progress, idle duration and queue depth while a task is running.

## Validation

- Command: `npm run verify`
- Result: passed.
- Evidence: `npm run verify` completed `tsc` and all `tests/*.test.ts`; `stat-immediate-handler.test.ts` still verifies active `/stat` can report a running task while the original task is blocked.

## Risk

- Intentional behavior change: long-running or idle tasks no longer proactively send heartbeat or timeout notifications.
- If a task stalls without activity, users must actively use `/stat`, `/stop`, or `/new`.
- Queue/watchdog/progress responsibilities are still in `message.handler`; this task only removes the timer-heavy proactive notification paths before a later queue/status Module extraction.

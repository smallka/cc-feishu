# T0015 - Extract workload queue

## Scope

- Keep control commands immediate.
- Keep only agent workload messages in the ordinary queue.
- Preserve per-chat serial execution.
- Preserve `/new` clearing only waiting workload.
- Preserve `/stat` active progress visibility, including queue depth.
- Preserve shutdown drain behavior.
- Preserve cross-chat isolation.
- Do not mix in `ChatManager` responsibility refactoring or Codex app-server state machine changes.

## Changes

- Added `src/bot/chat-workload-queue.ts` as the Module that owns workload queues, active processors, active progress, queue depth, clear, and stop/drain.
- Updated `src/handlers/message.handler.ts` so message intake parses/access-checks/materializes tasks, then delegates queued workload state and scheduling to `ChatWorkloadQueue`.
- Kept workload execution behavior in `message.handler` through a processing callback, so command routing, reactions, and agent send semantics stay unchanged.
- Added `tests/workload-queue-handler.test.ts` to lock down the risks discussed before implementation.

## Validation

- Command: `npm run verify`
- Result: passed.
- Evidence: `npm run verify` completed `tsc` and all `tests/*.test.ts`, including the new workload queue handler regression test.

## Risk Coverage

- Per-chat serial execution: covered by `workload-queue-handler.test.ts`.
- `/stat` active progress and queue depth: covered by `workload-queue-handler.test.ts` and existing `stat-immediate-handler.test.ts`.
- `/new` clearing queued workload: covered by `workload-queue-handler.test.ts`.
- Active progress cleanup after workload failure: covered by `workload-queue-handler.test.ts`.
- Cross-chat isolation: covered by `workload-queue-handler.test.ts`.
- Shutdown drain and message drop after stop starts: covered by `workload-queue-handler.test.ts`.

## Risks

- This remains an in-process FIFO queue; process crash or restart still drops waiting workload, same as before.
- Tests use handler-level stubs for `chatManager` and `messageService`; they validate queue semantics but do not exercise real Feishu network callbacks.
- `message.handler.ts` still owns message parsing, access/auto-bind, and media materialization; those are left as separate follow-up work.

## Related files

- `src/bot/chat-workload-queue.ts`
- `src/handlers/message.handler.ts`
- `tests/workload-queue-handler.test.ts`
- `docs/PROGRESS.md`

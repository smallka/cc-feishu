# T0014 - Control routing immediate

## Scope

- Keep access gate behavior unchanged.
- Move control messages out of the ordinary FIFO queue.
- Keep `/stop`, `/new`, `/stat`, `/help`, `/agent`, `/debug`, `/cd`, `/resume`, unknown slash commands, and active menu selection immediate.
- Keep agent workload messages as the only queued messages.
- Keep menu selection semantics unchanged, including numeric selection and `0` cancel.

## Changes

- Refactored `src/handlers/message.handler.ts` so text control paths are handled before queue materialization.
- Kept ordinary text, image, and file messages as queued workload only.
- Added `tests/control-routing-immediate.test.ts` to verify control commands do not enter the agent queue and menu selection is consumed immediately.

## Validation

- Command: `npm run verify`
- Result: passed.
- Evidence: `npm run verify` completed `tsc` and all `tests/*.test.ts`.

## Risks

- `message.handler.ts` still owns queue state, active progress state, and workload materialization; this task only narrows the queue boundary before a later extraction.
- `control-routing-immediate.test.ts` stubs several `chatManager` and `messageService` methods, so its logs still include expected Feishu network noise from reaction cleanup, but the assertions pass and do not depend on that side effect.

## Related files

- `src/handlers/message.handler.ts`
- `tests/control-routing-immediate.test.ts`
- `docs/PROGRESS.md`

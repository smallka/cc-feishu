# T0016 - Extract Feishu Message Content Intake

## Scope

- Extract Feishu message content parsing from `src/handlers/message.handler.ts` into `src/handlers/message-intake.ts`.
- Keep handler ownership of access gate, auto-bind, control command routing, media materialization and workload enqueue.
- Preserve existing text/image/file parsing behavior:
  - text content is JSON parsed and trimmed; empty text is skipped.
  - image content requires `image_key`.
  - file content requires `file_key` and preserves `file_name`.
  - unsupported message types are skipped.
  - malformed JSON is skipped after logging.

## Changed Files

- `src/handlers/message-intake.ts`
- `src/handlers/message.handler.ts`
- `tests/message-intake.test.ts`
- `docs/PROGRESS.md`

## Validation

Command:

```powershell
Set-Location C:\work\cc-feishu
npm run verify
```

Result: passed.

Evidence:

- `tsc` completed successfully.
- `tests/run-unit-tests.js` executed all `tests/*.test.ts`.
- New `message-intake.test.ts` passed and covers valid text/image/file parsing plus empty text, malformed JSON, missing media keys and unsupported message type.

## Notes

- Verification output still contains known noisy logs from existing tests:
  - a Feishu reaction removal warning caused by a mocked/test token path;
  - a synthetic workload failure emitted by `workload-queue-handler.test.ts`.
- Both are expected within the existing tests and did not fail `npm run verify`.

## Risk

- No intended behavior change.
- Media materialization remains in `message.handler.ts`; it is the next isolated refactor target.

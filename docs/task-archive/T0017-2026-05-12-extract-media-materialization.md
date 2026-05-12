# T0017 - Extract Feishu Media Materialization

## Scope

- Extract Feishu media materialization from `src/handlers/message.handler.ts` into `src/handlers/message-media-materialization.ts`.
- Keep handler ownership of access gate, auto-bind, control command routing and workload enqueue.
- Preserve existing media behavior:
  - text messages become queued tasks directly.
  - image/file messages still require Codex provider support before download.
  - image/file download failures still log and notify the user.
  - file messages still become a follow-up prompt that points the agent at the downloaded local path.

## Changed Files

- `src/handlers/message-media-materialization.ts`
- `src/handlers/message.handler.ts`
- `tests/message-media-materialization.test.ts`
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
- New `message-media-materialization.test.ts` passed and covers:
  - text task pass-through;
  - unsupported image/file provider rejection;
  - image/file download failure handling;
  - successful image/file materialization.

## Notes

- Verification output still contains known noisy logs from existing tests:
  - a Feishu reaction removal warning caused by a mocked/test token path;
  - malformed JSON logs from `message-intake.test.ts`;
  - a synthetic workload failure emitted by `workload-queue-handler.test.ts`.
- The new media materialization test intentionally emits image/file download failure logs while asserting the fallback user messages.

## Risk

- No intended behavior change.
- `message-media-materialization.ts` still depends on `chatManager` and `messageService` directly; this is acceptable for the current seam extraction, but download orchestration is not yet separated from provider lookup if we want a deeper seam later.

# T0021 - Prune Global Agent Docs

## Scope

- Remove global agent state and decision documents whose role had become ambiguous.
- Remove broad or historical protocol notes that are no longer current agent-facing facts.
- Keep only documents that affect future agent action, implementation, validation, deployment, or troubleshooting.
- Update `AGENTS.md` so task state is session-scoped and completed work is recorded in task archives.
- Further compact `AGENTS.md` under the rule that non-decision information should not be persisted as agent-facing instruction.
- Rework `AGENTS.md` from the agent guide template, selecting only project-specific rules worth adding back.
- Remove historical-change explanation plus standalone validation, commit, and encoding sections from `AGENTS.md`; keep the task section unchanged.
- Replace the task core concept section with the exact template wording at user request.

## Changed Files

- `AGENTS.md`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`
- `docs/PROTOCOL_SPEC.md`
- `docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md`
- `docs/STDIO_QUICKSTART.md`
- `docs/task-archive/T0021-2026-05-20-prune-global-agent-docs.md`

## Document Triage

- Deleted `docs/DECISIONS.md`: global decision logs were too broad and encouraged stale cross-cutting state. Decisions should live in the task archive unless they become reusable domain knowledge.
- Deleted `docs/PROGRESS.md`: global current-task tracking duplicated the user conversation and violated progressive disclosure.
- Deleted `docs/PROTOCOL_SPEC.md`: broad protocol notes were not a reliable current implementation source; current facts should be read from `src/` and task-specific tests.
- Deleted `docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md`: Python migration notes are historical background, not current implementation fact.
- Deleted `docs/STDIO_QUICKSTART.md`: duplicated protocol details and referenced stale paths; current Claude stdio behavior is represented by `src/claude/*` and manual test scripts.
- Kept `docs/pm2-win11-pidusage-fix.md`: it directly affects Windows deployment troubleshooting and is referenced by `INSTALL.md`.
- Compacted `AGENTS.md`: removed descriptive purpose text, repeated workflow detail, and event-style encoding incident narrative; retained only rules that change future agent action.
- Re-shaped `AGENTS.md` around the template sections: project overview, task core concept, key docs/directories, verification, and commit/encoding rules.
- Final `AGENTS.md` shape keeps only project overview, unchanged task core concept, and key docs/directories.
- The task core concept section now directly follows the template, including `docs/tasks/`.

## Validation

Commands:

```powershell
Set-Location C:\work\cc-feishu
rg -n "STDIO_QUICKSTART|PROTOCOL_SPEC|PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES|docs/PROGRESS|docs/DECISIONS|DECISIONS.md|PROGRESS.md" AGENTS.md README.md INSTALL.md package.json docs -g "!docs/task-archive/**"
npm run verify
git diff --check
```

Result: passed.

## Evidence

- Current entry documents no longer reference the deleted global docs; historical references remain only in task archives.
- `npm run verify` completed successfully, including `tsc` and all unit tests.
- Verification output still includes existing noisy mocked-test logs around Feishu token/reaction cleanup, malformed intake JSON, synthetic media download failures, and synthetic workload failure.
- After the second-pass `AGENTS.md` compaction, the current entry reference check still returned no matches.
- After the template-based rewrite, `AGENTS.md` still avoids `PROGRESS`, `DECISIONS`, and deleted protocol/history document references.
- After the final requested pruning, `AGENTS.md` no longer has standalone validation, commit, or encoding sections; validation terms remain only inside the unchanged task concept.
- `docs/tasks/` has been created with a `.gitkeep` placeholder so the template activity-task path exists in the repository.
- `git diff --check` reported no whitespace errors.

## Risks

- Historical task archives still mention the deleted documents because those references describe past work. They are retained as historical evidence, not current entry points.
- Removing broad protocol notes means future protocol work should start from current source and focused tests rather than old documentation.

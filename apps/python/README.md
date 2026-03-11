# cc-feishu Python App

This is the current Python implementation of the Feishu bot. It uses `claude-agent-sdk` to drive Claude Code through the official Python SDK.

## Quick start

```bash
pip install -e .
cp .env.example .env
python -m src.main
```

## Main paths

- [`src`](./src) - application source
- [`tests`](./tests) - Python tests
- [`scripts`](./scripts) - local run helpers
- [`INSTALL.md`](./INSTALL.md) - setup and deployment notes
- [`CLAUDE.md`](./CLAUDE.md) - implementation notes for this app
- [`../../docs/PROTOCOL_SPEC.md`](../../docs/PROTOCOL_SPEC.md) - shared Claude protocol reference

## Notes

- This app now lives under `apps/python`.
- The repository root keeps shared documents and the parallel TypeScript implementation under `apps/typescript`.

# cc-feishu

This repository now keeps both implementations of the same Feishu bot side by side.

## Layout

```text
apps/
  python/      Python implementation built around claude-agent-sdk
  typescript/  TypeScript implementation restored from the typescript-final tag
docs/          Shared design notes, plans, and protocol references
```

## Choose an app

### Python

Use [`apps/python`](./apps/python) if you want the current Python runtime based on `claude-agent-sdk`.

Quick start:

```bash
cd apps/python
pip install -e .
python -m src.main
```

### TypeScript

Use [`apps/typescript`](./apps/typescript) if you want the original Node/TypeScript implementation and the better starting point for a future Codex SDK integration.

Quick start:

```bash
cd apps/typescript
npm install
npm run dev
```

## Notes

- The root `.env` was left in place to avoid touching local user configuration.
- Run commands from each app directory so `.env` and the default work root resolve from that app root.
- The Python and TypeScript apps each keep their own `.env.example`.
- Shared repository-level documents remain under [`docs`](./docs).
- [`apps/typescript/docs`](./apps/typescript/docs) is a restored TypeScript-era snapshot, while [`docs`](./docs) is the repository-level doc area going forward.

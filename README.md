# cc-feishu

Feishu bot implementation built on the TypeScript runtime.

## Layout

```text
apps/
  typescript/  TypeScript implementation
docs/          Repository-level design notes, plans, and protocol references
```

## Quick Start

Use [`apps/typescript`](./apps/typescript) as the only maintained application.

```bash
cd apps/typescript
npm install
npm run dev
```

## Notes

- The root `.env` was left in place to avoid touching local user configuration.
- Run commands from `apps/typescript` so `.env` and the default work root resolve from the app root.
- Shared repository-level documents remain under [`docs`](./docs).
- [`apps/typescript/docs`](./apps/typescript/docs) is a restored TypeScript-era snapshot, while [`docs`](./docs) is the repository-level doc area going forward.
- The historical Python implementation has been removed. Runtime boundary notes remain in [`docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md`](./docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md).

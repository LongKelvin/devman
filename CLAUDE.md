# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this project is

`devman` is a lightweight local development service manager (Node/TypeScript
CLI + background daemon), inspired by PM2 and systemd. Full design:
[ARCHITECTURE.md](./ARCHITECTURE.md). Terminal output conventions:
[UI-UX.md](./UI-UX.md).

**Status: feature-complete (Phases 1–5).** All commands work: `start`,
`status`, `stop`, `restart`, `log`, `info`, `doctor`, with `--profile`
scoping. Do not re-implement the phases from scratch — this is now
maintenance/extension work. Read `ARCHITECTURE.md` and the relevant
`src/` module before changing behaviour; don't redesign the architecture,
extend it.

## Technology

- Node.js 20+, TypeScript (strict — see `tsconfig.json`: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUnusedLocals/Params`, `verbatimModuleSyntax`)
- Commander (CLI), execa (process spawning), cli-table3 + chalk (terminal
  rendering), ora (spinners)
- Vitest (unit + integration tests), ESLint + Prettier

## Principles (already in force — keep following them)

- SOLID, small single-responsibility modules (see the `src/` → component
  mapping in ARCHITECTURE.md)
- Composition over inheritance
- Async/await everywhere; no callback-style code
- Strong typing — no `any`, no unchecked casts; extend the types in
  `src/types/` rather than reaching around them
- No duplicated logic — colour/format decisions live in `cli/render.ts` and
  `ui/statusTable.ts`; error definitions live in `utils/errors.ts`
- Production-quality error handling: every thrown error is a `DevmanError`
  subclass with a stable `ErrorCode` and an actionable `hint` (see
  ARCHITECTURE.md § Error Handling)
- Generic for any project — **no workspace-specific paths**; everything
  derives from `--home`/`DEVMAN_HOME`/cwd (see `src/config/paths.ts`)
- Cross-platform: macOS/Linux (Unix socket, process groups) and Windows
  (named pipe, direct process kill) both must keep working

## Working in this repo

- The CLI never owns a child process — every command is an IPC call to the
  daemon (`src/cli/daemonClient.ts` → `src/daemon/handlers.ts`). Don't add
  code that spawns/kills processes from `src/cli/`.
- New daemon capabilities: add the method to `IpcMethod` in
  `src/ipc/protocol.ts`, implement it in `src/daemon/handlers.ts`, and add a
  thin CLI handler in `src/cli/handlers.ts` — keep handlers thin (resolve +
  render, no business logic).
- New terminal output goes through `src/cli/render.ts` /
  `src/ui/statusTable.ts`, following [UI-UX.md](./UI-UX.md) (colour mapping,
  spinner phrasing, `-` for N/A cells, stdout-vs-stderr split).
- New error cases: add an `ErrorCode` + a `DevmanError` subclass in
  `src/utils/errors.ts` with a real hint, don't throw bare `Error`.
- Config schema changes: update `src/config/validate.ts`,
  `config/services.example.json`/`config/profiles.example.json`, and the
  tables in `README.md` and `ARCHITECTURE.md` together.

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint . --max-warnings 0
npm run format       # prettier --write .
npm run build        # compile to dist/
npm test              # vitest run
npm run test:watch    # vitest
```

Run `typecheck`, `lint` and `test` before considering a change done — strict
TS + `noUnusedLocals`/`noUnusedParameters` + `max-warnings 0` will fail on
things that "just work" at runtime.

## Tests

- `tests/unit/` — pure logic (codec, dependency graph, health checker,
  managed process, paths, pidfile, service logger, socket transport, state,
  validation). Add one here for new pure functions/classes.
- `tests/integration/` — daemon end-to-end, health probes, process manager
  orchestration. Add/extend one here for anything crossing process or IPC
  boundaries.

## Deliverables expected of any change

- Source code following the module boundaries above
- Updated `README.md` / `ARCHITECTURE.md` / `UI-UX.md` when behaviour,
  config shape, or terminal output changes
- Unit and/or integration tests covering the change

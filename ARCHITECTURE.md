# Dev Manager Architecture

## Vision

`devman` is a lightweight local development service manager inspired by PM2
and systemd. It manages local workspace services (API, database, web,
workers, …) through a background daemon and a thin CLI, so a whole dev stack
can be started, watched and torn down from one place.

## Status

Feature-complete for Phases 1–5. All commands are implemented and tested:
`start`, `status`, `stop`, `restart`, `log`, `info`, `doctor`, `list`, with
`--profile` scoping. Cross-platform: macOS, Linux, Windows (Node.js 20+).

## High-Level Architecture

```text
Terminal
   │
 devman CLI  (thin client, no process ownership)
   │
IPC (Unix domain socket / Windows named pipe)
   │
Daemon (long-lived, detached)
 ├─ Process Manager   (ManagedProcess, ServiceSupervisor)
 ├─ Dependency Graph  (topological start/stop order)
 ├─ Health Checker    (process / tcp / http probes)
 ├─ Service Logger    (per-service log files, live tail)
 ├─ Runtime State      (in-memory + persisted)
 └─ IPC Server         (request/response + streaming)
```

The CLI never owns a child process. Every action — even the very first
`devman start` — is an IPC call to the daemon; the daemon is the sole owner of
managed processes. This is what makes `devman status` from a second terminal,
crash recovery, and detached daemon lifetime possible.

## Project Structure

```text
devman/
├── ARCHITECTURE.md
├── CLAUDE.md
├── UI-UX.md
├── README.md
├── config/
│   ├── services.example.json
│   └── profiles.example.json
├── src/
│   ├── cli/        # Commander program, handlers, IPC client, rendering
│   ├── daemon/      # Daemon process: bootstrap, IPC handlers, pidfile
│   ├── ipc/         # Transport-agnostic protocol, codec, server, client
│   ├── process/     # ManagedProcess, ServiceSupervisor, ProcessManager
│   ├── service/     # Dependency graph, health checker/probe
│   ├── config/       # Path resolution, config loading, validation
│   ├── logging/      # Diagnostic logger + per-service log capture
│   ├── ui/           # Terminal rendering (tables, colours)
│   └── utils/        # Errors, filesystem, time helpers
├── tests/
│   ├── unit/
│   └── integration/
└── package.json
```

Each `src/` module maps 1:1 to a component below and has a single
responsibility — this is what phases 2–5 were layered onto without rewrites.

## Components

### CLI (`src/cli/`)

A Commander-based program (`program.ts`) with injectable handlers
(`handlers.ts`) so the command shape stays free of I/O and is unit-testable.
`context.ts` resolves global options (`--home`, `--config`, `-v`) into a
`CliContext` (paths + logger). `daemonClient.ts` opens an IPC connection and
makes request/response (or streaming) calls. `render.ts` centralises
`printSuccess` / `printInfo` / `printError` so colour and formatting live in
one place.

### Daemon (`src/daemon/`)

A long-lived, fully detached (`unref()`) background process. `bootstrap.ts`
spawns it on demand (`ensureDaemon`) and pings it (`pingDaemon`) so `devman
start` self-heals if the daemon isn't already running. `daemon.ts` wires the
process manager, health checker, logger and IPC server together and owns
graceful shutdown (SIGTERM/SIGINT → stop all services → remove pidfile →
exit). `handlers.ts` implements each `IpcMethod`. `pidfile.ts` persists the
daemon's PID so a second `devman` invocation can detect it's already running
(`DAEMON_ALREADY_RUNNING`) rather than double-spawning.

### IPC (`src/ipc/`)

Transport-agnostic wire protocol (`protocol.ts`): every exchange is
request/response correlated by an `id`, newline-delimited JSON
(`codec.ts`). A request may yield zero or more `stream` messages before its
terminal `response` — this is how `devman log <svc>` follows live output over
one long-lived connection. The transport is injectable
(`IpcServerTransport` / `IpcClientTransport`); today it's a Unix domain
socket at `runtime/daemon.sock` on macOS/Linux and a named pipe
(`\\.\pipe\devman-<hex>`) on Windows (`socketTransport.ts`).

Methods: `ping`, `status`, `start`, `stop`, `restart`, `info`, `logs`,
`shutdown`. `start`/`stop` accept an optional `profile` name alongside the
resolved service `ids` (the CLI resolves the profile client-side; the name
travels along purely so the daemon can record it — see "active profile"
below).

### Process Manager (`src/process/`)

- `ManagedProcess` wraps a single spawned service (via `execa`): tracks pid,
  status, exit code/signal, and exposes start/stop.
- `ServiceSupervisor` owns one service's lifecycle: applies `restart.policy`
  (`no` / `on-failure` / `always`) with `maxRetries` and a `delayMs` backoff
  on unexpected exit, and reports state transitions onto the event stream.
- `ProcessManager` orchestrates all services together: resolves start order
  from the dependency graph, starts dependencies before dependents, stops in
  reverse order, and aggregates runtime state for `status`/`info`.
- Each service runs in its own process group on macOS/Linux
  (`detached: true`, killed via `-pid`) so stopping it reaps the whole
  process tree; on Windows the child is terminated directly
  (`TerminateProcess` semantics), since process groups aren't available.

### Service (`src/service/`)

- `dependencyGraph.ts` builds a DAG from each service's `dependsOn`, detects
  cycles (`DependencyCycleError`) and missing references
  (`DependencyMissingError`), and produces a topological start order (stop
  order is the reverse).
- `healthProbe.ts` defines the `HealthProbe` interface and the three
  strategies: `process` (alive check, the default), `tcp` (connect to
  `port`), `http` (GET `url`, healthy on 2xx/3xx). A `tcp`/`http` check
  missing its required field degrades gracefully to `process`.
- `healthChecker.ts` polls each service's probe on `intervalMs` (default
  5000ms, `timeoutMs` default 2000ms) and updates its `health` status
  (`healthy` / `unhealthy` / `unknown`), surfaced in `status`'s `HEALTH`
  column and in `info`.

### Config (`src/config/`)

`paths.ts` resolves the base directory in this order: `--home` →
`DEVMAN_HOME` → cwd, then derives `config/`, `logs/`, `runtime/` under it
(each individually overridable via `--config`/`DEVMAN_CONFIG_DIR`,
`DEVMAN_LOGS_DIR`, `DEVMAN_RUNTIME_DIR`). `loader.ts` reads
`services.json`/`profiles.json` and exposes `resolveProfile(name)`.
`validate.ts` enforces schema, unique ids, and defers dependency-cycle
detection to the dependency graph. No paths or services are hardcoded —
`devman` is generic for any project. `registry.ts` is the one piece of
_cross_-`--home` state: a small, best-effort JSON index at
`~/.devman/registry.json` (override: `DEVMAN_REGISTRY_FILE`) that every
daemon upserts itself into on `start` and removes itself from on graceful
`shutdown`, purely so `devman list` can answer "what's running, and where"
without needing to stand inside each project. It's read-modify-write with no
cross-process locking — acceptable because it's self-healing: `devman list`
prunes any entry whose pid is dead, and a daemon that drops out on a lost
write just re-registers on its next `start`.

### Logging (`src/logging/`)

`logger.ts` is the internal diagnostic logger (daemon/CLI operational logs,
respects `-v`/`--verbose` and `DEVMAN_DEBUG`). `serviceLogger.ts` captures
each managed service's stdout/stderr to `logs/<id>.log` with timestamps and
stream tagging, and supports live tailing for `devman log`.

### UI (`src/ui/`)

`statusTable.ts` renders `RuntimeState` as a `cli-table3` table
(`SERVICE STATUS PID UPTIME RESTARTS HEALTH`) and single-service detail as a
key/value table, with `chalk` colour-coding by status/health. See
[UI-UX.md](./UI-UX.md) for the full terminal design language.

### Utils (`src/utils/`)

`errors.ts` defines `DevmanError` and subclasses, each carrying a stable
`ErrorCode` and an optional user-facing `hint` — this is what lets the CLI
render friendly messages without string-matching and lets IPC serialise
errors losslessly (`IpcErrorPayload`). `fs.ts` and `time.ts` are small
platform-safe helpers.

## Configuration

### `services.json`

Each service definition:

| Field         | Type     | Default       | Notes                                     |
| ------------- | -------- | ------------- | ----------------------------------------- |
| `id`          | string   | —             | Required, unique                          |
| `name`        | string   | `id`          | Display name                              |
| `cwd`         | string   | `.`           | Resolved relative to the config base      |
| `command`     | string   | —             | Required executable                       |
| `args`        | string[] | `[]`          | Command arguments                         |
| `enabled`     | boolean  | `true`        | Participate in bulk start/stop            |
| `dependsOn`   | string[] | `[]`          | Service ids that must start first         |
| `env`         | object   | `{}`          | Extra environment variables               |
| `restart`     | object   | on-failure ×5 | `{ policy, maxRetries, delayMs }`         |
| `healthCheck` | object   | —             | `{ type, url?, port?, intervalMs?, ... }` |

### `profiles.json`

Named groups of service ids (e.g. `backend`, `frontend`, `full`) used by
`--profile` to scope `start`/`stop`/`restart` to a subset. A scoped `stop`
stops only that profile's services and leaves the daemon running; a bare
`stop` stops everything and shuts the daemon down.

### Active profile

`RuntimeState.activeProfile` records the name passed to the most recent
`start` (`null` for an unscoped start, or before any start). It's purely
informational — `RuntimeState.services` is always the source of truth for
what's actually running — but it's what lets `status`, `doctor`, and `list`
answer "which profile is this?" without the user having to remember which
flag they used. Every `start` overwrites it (to the given profile, or `null`
for an unscoped start); a scoped `stop` clears it back to `null`, but only
when it targets exactly the profile that's currently recorded — stopping
some other profile leaves it as-is.

## Lifecycle

```
configured → starting → running → stopping → stopped
                              └─(unexpected exit)→ failed → (restart policy) → starting
```

## Error Handling

Every thrown error extends `DevmanError` with a stable `ErrorCode`
(`CONFIG_NOT_FOUND`, `CONFIG_INVALID`, `SERVICE_NOT_FOUND`,
`DEPENDENCY_CYCLE`, `DEPENDENCY_MISSING`, `DAEMON_NOT_RUNNING`,
`DAEMON_ALREADY_RUNNING`, `IPC_ERROR`, `IPC_TIMEOUT`,
`PROCESS_START_FAILED`, `INTERNAL`) and an optional actionable `hint`.
Errors cross the IPC boundary as `IpcErrorPayload` and are re-rendered as
`DevmanError` on the client, so a failure originating in the daemon prints
the same friendly block as one raised locally in the CLI (see
[UI-UX.md](./UI-UX.md#errors)).

Beyond per-call error handling, the daemon entry point (`src/daemon/index.ts`)
installs a last-resort `uncaughtException`/`unhandledRejection` handler that
logs and lets the daemon keep running. It's specifically there because the
daemon is a fully detached background process supervising every service on
the host — an isolated bug in some rarely-hit path must not silently take
the whole stack down with it. It's a net, not a substitute for handling
errors at the source: `RuntimeStateStore.persist()` is the concrete example
that motivated it (see below) and is fixed at the source too.

### Runtime-state persistence is serialised, not fire-and-forget

`RuntimeStateStore` writes the whole `RuntimeState` document to
`state.json` via write-temp-then-rename on every `updateService` call.
Two services changing state in the same tick (two health checks resolving
together, several services finishing startup close together) used to issue
overlapping renames onto that one destination — safe on POSIX (atomic
`rename(2)`), but Windows can throw `EPERM`/`EBUSY` when the destination is
momentarily held by another handle. `persist()` now queues writes so renames
onto `stateFile` are strictly serialised, `writeJsonFileAtomic` retries a
transient `EPERM`/`EBUSY` with backoff as a second line of defense, and the
health-checker callback (previously `void`-fire-and-forget) now awaits and
logs instead of letting a rejection there crash the process uncaught.

## Testing

- `tests/unit/` — pure logic: codec, dependency graph, health checker,
  managed process, paths, pidfile, registry, service logger, socket
  transport, state, validation.
- `tests/integration/` — daemon end-to-end (spawn, IPC round-trip, shutdown),
  the active-profile IPC round-trip, the instance registry across multiple
  daemons, health probes against real sockets/HTTP, process manager
  orchestration.

## Future Roadmap

- Interactive TUI (live-updating status view)
- Watch mode (restart on file change)
- Plugin system
- Notifications
- Metrics / log rotation

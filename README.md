# devman

A lightweight local development service manager, inspired by PM2 and systemd,
but focused on the services you run while developing. A background **daemon**
owns your dev processes; a thin **CLI** (`devman`) talks to it over IPC.

> Status: **feature-complete (Phases 1–5)**. The daemon supervises services with
> dependency-ordered start/stop, per-service log capture, crash detection and
> restart policies, plus periodic health checks (process/tcp/http). All commands
> work: `devman start`, `devman status`, `devman stop`, `devman restart`,
> `devman log <svc>` (live streaming), `devman info <svc>`, `devman doctor`,
> `devman list` (every instance on the machine), plus `--profile <name>`
> scoping.

## Why

Running a real app locally usually means juggling several long-lived processes
(API, database, web, workers) with dependencies between them. `devman` starts,
stops, restarts and monitors them from one place, with centralized config and
per-service logs.

## Install

```bash
npm install
npm run build
npm link   # optional: puts `devman` on your PATH
```

Requires Node.js 20+. Works on **macOS, Linux, and Windows** (Node.js 20+).

## Quick start

1. Create a `config/` directory in your project and add a `services.json`
   (copy [`config/services.example.json`](./config/services.example.json)):

   ```json
   {
     "services": [
       {
         "id": "api",
         "name": "API Server",
         "cwd": "./api",
         "command": "npm",
         "args": ["run", "dev"],
         "dependsOn": ["db"]
       },
       {
         "id": "db",
         "command": "docker",
         "args": ["compose", "up", "postgres"],
         "healthCheck": { "type": "tcp", "port": 5432 }
       }
     ]
   }
   ```

   Note the missing `-d`/`--detach`: this deliberately runs `docker compose
up` in the _foreground_, as the process devman itself supervises — see
   [Docker and other long-lived infra](#docker-and-other-long-lived-infra)
   below for why, and for the tradeoffs of the alternative.

2. Optionally group services into profiles in `config/profiles.json`:

   ```json
   { "backend": ["db", "api"], "full": ["db", "api", "web"] }
   ```

3. Check everything is wired up:

   ```bash
   devman doctor
   ```

## Commands

| Command                   | Description                                                                 |
| ------------------------- | --------------------------------------------------------------------------- |
| `devman` / `devman start` | Start all enabled services (via daemon)                                     |
| `devman status`           | Show status of all services                                                 |
| `devman stop`             | Stop all services and the daemon                                            |
| `devman restart`          | Restart all services                                                        |
| `devman log <svc>`        | Stream logs for a service                                                   |
| `devman info <svc>`       | Show detailed info for a service                                            |
| `devman doctor`           | Diagnose configuration and daemon health                                    |
| `devman list` (`ls`)      | List every devman instance on this machine, across all `--home` directories |

Global options: `--home <dir>`, `--config <dir>`, `-v, --verbose`. The
`--profile <name>` option on `start`, `stop`, and `restart` scopes the action to
a profile's services (a scoped `stop` leaves the daemon running). The profile
passed to `start` is recorded as the daemon's _active profile_ and shown by
`status`, `doctor`, and `list` — informational only, it never affects which
services are actually running.

### Working with several projects at once

Every `--home` is a fully isolated instance (its own config, logs, runtime
dir and IPC socket) — running `devman start` in `~/code/service-a` and
`~/code/service-b` starts two independent daemons that never interfere with
each other, each with its own dependency graph, restart policies and
profiles. This is the intended way to juggle several projects that each
define their own `services.json`.

The one thing that _is_ shared across projects is a small registry at
`~/.devman/registry.json` (override with `DEVMAN_REGISTRY_FILE`), used only
by `devman list` to answer "what's running, and where" without `cd`-ing into
every project:

```text
$ devman list
HOME                        PID    PROFILE  SERVICES      UPTIME
~/code/leadsheet-monolith   17892  infra    2/4 running   1m 12s
~/code/other-service        13768  -        2/2 running   45s
```

Losing this file is harmless — a running daemon re-registers on its next
`start`, and `devman list` prunes any entry whose process is no longer alive.

### How process management works

- Services start in dependency order (a service's `dependsOn` are started
  first) and stop in reverse order.
- Each service's stdout/stderr is captured to `logs/<id>.log` with timestamps.
- On unexpected exit the `restart.policy` decides whether to relaunch
  (`on-failure` restarts on non-zero exit; `always` restarts on any exit),
  bounded by `restart.maxRetries` with a `restart.delayMs` backoff.
- Each service runs in its own process group (on macOS/Linux), so stopping it
  reaps the whole process tree (no orphaned grandchildren). On Windows, the
  process is terminated directly.

### Docker and other long-lived infra

`devman` has no special-cased "docker" service type — a `docker compose ...`
entry is just a `command` like any other, supervised the same way as your
app code. That has one real consequence worth being deliberate about:
**`devman` only ever knows about the one process it spawned**, so what you
put in `command`/`args` determines what `devman stop` actually stops.

- `args: ["compose", "up", "postgres"]` (no `-d`) runs `docker compose up`
  in the foreground as the supervised process. `devman stop` sends it the
  same signal as any other service, which `docker compose up` translates
  into `docker compose down` for you — containers stop when devman says so,
  same as everything else. This is the pattern in the example above and the
  one to prefer when devman should fully own the infra's lifecycle.
- `args: ["compose", "up", "-d", "postgres"]` runs detached: the supervised
  process exits almost immediately (successfully), so devman has nothing
  left to watch — it can't restart a crashed container, and `devman stop`
  won't touch it. Only reach for this if you're intentionally treating the
  containers as pre-existing infra devman shouldn't own (e.g. a shared
  Postgres you start once, outside any project, and just want `devman` to
  health-check via `healthCheck: { "type": "tcp", "port": 5432 }`).

Either way, pair a docker service with a `healthCheck` — a container takes
longer to become _ready_ than to start, and without one devman reports
`running` the moment the process spawns, not once Postgres is actually
accepting connections.

## Platform support

`devman` runs on **macOS, Linux, and Windows**. Platform-specific behaviour:

| Feature       | macOS / Linux                                       | Windows                                  |
| ------------- | --------------------------------------------------- | ---------------------------------------- |
| IPC transport | Unix domain socket (`runtime/daemon.sock`)          | Named pipe (`\\.\pipe\devman-<hex>`)     |
| Process group | `detached: true` + signal `-pid` (reaps whole tree) | Direct child kill via `TerminateProcess` |
| Daemon spawn  | Fully detached (`unref()`)                          | Fully detached (`unref()`)               |

## Configuration

`devman` is generic: it hardcodes no paths and no services. Everything derives
from a base directory, resolved in this order:

1. `--home <dir>`
2. `DEVMAN_HOME`
3. the current working directory

| Path        | Default          | Override                        |
| ----------- | ---------------- | ------------------------------- |
| config dir  | `<home>/config`  | `--config`, `DEVMAN_CONFIG_DIR` |
| logs dir    | `<home>/logs`    | `DEVMAN_LOGS_DIR`               |
| runtime dir | `<home>/runtime` | `DEVMAN_RUNTIME_DIR`            |

### Service fields

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

`restart.policy` is one of `no`, `on-failure`, `always`.

#### Health checks

An optional `healthCheck` monitors a running service on an interval; its result
appears in the `HEALTH` column and in `--info`.

| Type      | Required field | Meaning                                         |
| --------- | -------------- | ----------------------------------------------- |
| `process` | —              | Healthy while the process is running (default). |
| `tcp`     | `port`         | Healthy while a TCP connection to `port` opens. |
| `http`    | `url`          | Healthy while a GET to `url` returns 2xx/3xx.   |

Common options: `intervalMs` (poll interval, default 5000) and `timeoutMs`
(per-probe timeout, default 2000). A `tcp`/`http` check missing its required
field degrades gracefully to the `process` strategy.

```json
{ "type": "http", "url": "http://localhost:4000/health", "intervalMs": 5000 }
```

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write
npm run build       # compile to dist/
npm test            # vitest
```

For a full local QA pass — an isolated test project, fixture services, and
a checklist covering every command and failure case — see
[TESTING.md](./TESTING.md).

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md). Modules under `src/` map to the
documented components, each with a single responsibility:

| Module     | Responsibility                                                |
| ---------- | ------------------------------------------------------------- |
| `cli/`     | Thin client; parses commands and renders results over IPC.    |
| `daemon/`  | Long-lived process; owns state and children; hosts IPC.       |
| `ipc/`     | Transport-agnostic protocol, codec, server and client.        |
| `process/` | Process supervision: managed processes, supervisors, manager. |
| `service/` | Dependency graph and health checks.                           |
| `runtime/` | Persisted runtime state and the internal event bus.           |
| `logging/` | Per-service log capture and the internal diagnostic logger.   |
| `config/`  | Path resolution, config loading and validation.               |
| `ui/`      | Terminal rendering (tables, colours).                         |
| `utils/`   | Errors, filesystem and time helpers.                          |

The transport is injectable (`IpcServerTransport`/`IpcClientTransport`), the
event bus decouples supervision from cross-cutting consumers, and health probes
sit behind a `HealthProbe` interface — so profiles, watch mode, notifications
and metrics on the roadmap can be added without restructuring.

## License

MIT

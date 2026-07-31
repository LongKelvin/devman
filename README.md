# devman

A lightweight local development service manager, inspired by PM2 and systemd,
but focused on the services you run while developing. A background **daemon**
owns your dev processes; a thin **CLI** (`start-dev`) talks to it over IPC.

> Status: **Phase 3** — full process management. The daemon supervises services
> with dependency-ordered start/stop, per-service log capture, crash detection
> and restart policies. All commands work: `start-dev`, `--status`, `--stop`,
> `--restart`, `--log <svc>` (live streaming), `--info <svc>`, `doctor`, plus
> `--profile <name>` scoping. Phase 4/5 add health checks and further polish.

## Why

Running a real app locally usually means juggling several long-lived processes
(API, database, web, workers) with dependencies between them. `devman` starts,
stops, restarts and monitors them from one place, with centralized config and
per-service logs.

## Install

```bash
npm install
npm run build
npm link   # optional: puts `start-dev` / `devman` on your PATH
```

Requires Node.js 20+.

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
         "args": ["compose", "up", "postgres"]
       }
     ]
   }
   ```

2. Optionally group services into profiles in `config/profiles.json`:

   ```json
   { "backend": ["db", "api"], "full": ["db", "api", "web"] }
   ```

3. Check everything is wired up:

   ```bash
   start-dev doctor
   ```

## Commands

| Command                  | Description                              |
| ------------------------ | ---------------------------------------- |
| `start-dev`              | Start all enabled services (via daemon)  |
| `start-dev --status`     | Show status of all services              |
| `start-dev --stop`       | Stop all services and the daemon         |
| `start-dev --restart`    | Restart all services                     |
| `start-dev --log <svc>`  | Stream logs for a service                |
| `start-dev --info <svc>` | Show detailed info for a service         |
| `start-dev doctor`       | Diagnose configuration and daemon health |

Global options: `--home <dir>`, `--config <dir>`, `-v, --verbose`. The
`--profile <name>` option scopes `start-dev`, `--stop` and `--restart` to a
profile's services (a scoped `--stop` leaves the daemon running).

### How process management works

- Services start in dependency order (a service's `dependsOn` are started
  first) and stop in reverse order.
- Each service's stdout/stderr is captured to `logs/<id>.log` with timestamps.
- On unexpected exit the `restart.policy` decides whether to relaunch
  (`on-failure` restarts on non-zero exit; `always` restarts on any exit),
  bounded by `restart.maxRetries` with a `restart.delayMs` backoff.
- Each service runs in its own process group, so stopping it reaps the whole
  process tree (no orphaned grandchildren).

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

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write
npm run build       # compile to dist/
npm test            # vitest
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md). Modules under `src/` map to the
documented components: `cli/`, `daemon/`, `ipc/`, `process/`, `runtime/`,
`logging/`, `service/`, `config/`, `ui/`, `utils/`.

## License

MIT

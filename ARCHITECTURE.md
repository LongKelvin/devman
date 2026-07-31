# Dev Manager Architecture

## Vision

Dev Manager is a lightweight local development service manager inspired by PM2 and systemd. It manages local workspace services through a background daemon and a CLI.

## Goals

- Start/stop/restart development services.
- Centralized configuration.
- Persistent daemon.
- Live log streaming.
- Service monitoring.
- Extensible architecture.

## High-Level Architecture

```text
Terminal
   │
start-dev CLI
   │
IPC (Unix Socket / Named Pipe)
   │
Daemon
 ├─ Process Manager
 ├─ Logger
 ├─ Runtime State
 ├─ Health Checker
 └─ Event Bus
```

## Project Structure

```text
dev-manager/
├── ARCHITECTURE.md
├── CLAUDE.md
├── config/
│   ├── services.json
│   └── profiles.json
├── src/
│   ├── cli/
│   ├── daemon/
│   ├── ipc/
│   ├── process/
│   ├── runtime/
│   ├── logging/
│   ├── service/
│   ├── ui/
│   └── utils/
├── logs/
├── runtime/
└── package.json
```

## Components

### CLI

Thin client that communicates with the daemon.

### Daemon

Owns every child process and exposes IPC commands.

### Process Manager

Starts, stops, restarts and monitors services.

### Runtime State

Stores daemon PID, state and runtime metadata.

### Logger

Writes stdout/stderr to per-service log files and supports live streaming.

### IPC

Communication between CLI and daemon.

### Event Bus

Internal events:

- ServiceStarted
- ServiceStopped
- ServiceFailed
- LogReceived
- HealthChanged

## Configuration

`services.json`

Each service defines:

- id
- name
- cwd
- command
- args
- enabled
- dependsOn
- env
- restart
- healthCheck

`profiles.json`

Logical groups such as backend, frontend and full.

## Lifecycle

Configured → Starting → Running → Stopping → Stopped

Unexpected exit → Failed

## Commands

- start-dev
- start-dev --status
- start-dev --stop
- start-dev --restart
- start-dev --log <service>
- start-dev --info <service>
- start-dev doctor

## Dependency Resolution

Services form a directed acyclic graph. Dependencies must start before dependents.

## Logging

Each service writes to:

```
logs/<service>.log
```

Support live tailing, timestamps, stdout/stderr separation and future log rotation.

## Future Roadmap

- Interactive TUI
- Watch mode
- Auto restart
- Plugin system
- Notifications
- Metrics

# Claude Implementation Prompt

## Objective

Implement the project exactly as described in `ARCHITECTURE.md`.

Do not redesign the architecture. Extend it only where implementation details are required.

## Technology

- Node.js LTS
- TypeScript (strict)
- Commander
- execa
- cli-table3
- chalk
- ora

## Principles

- SOLID
- Small modules
- Composition over inheritance
- Async/await
- Strong typing
- No duplicated logic
- Production-quality error handling

## Phases

### Phase 1

- Project bootstrap
- CLI
- Configuration loader
- Logging
- Runtime directories

### Phase 2

- Daemon
- IPC
- Runtime state
- Graceful shutdown

### Phase 3

- Process manager
- Start/stop/restart
- Crash detection
- Dependency ordering

### Phase 4

Implement:

- start-dev
- --status
- --stop
- --restart
- --log
- --info
- doctor

### Phase 5

- Tests
- Documentation
- Cleanup
- Performance review

## Deliverables

- Source code
- README
- Sample configuration
- Unit tests
- Integration tests

## Constraints

- No workspace-specific paths.
- Generic for any project.
- Cross-platform (macOS/Linux first).
- Keep implementation modular and extensible.

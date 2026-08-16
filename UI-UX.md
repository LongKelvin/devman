# Terminal UI/UX Guidelines

`devman` is a CLI-only tool — there is no GUI, so the terminal output _is_ the
product. These are the conventions the codebase already follows in `src/cli/render.ts`
and `src/ui/statusTable.ts`; keep new output consistent with them.

## Principles

1. **stdout is data, stderr is diagnostics.** Command results (tables, log
   lines, info blocks) go to `stdout`. Errors, warnings and progress spinners
   go to `stderr` where they don't pollute piped/redirected output.
2. **Every long-running action gets a spinner.** Anything that waits on the
   daemon or a process (`start`, `restart`, `stop`) uses `ora` so the user
   sees the CLI is alive, not hung.
3. **Colour conveys state, never meaning alone.** Status/health colours are a
   scanning aid on top of text labels (`running`, `healthy`, …) — never the
   only signal, so output stays legible with `NO_COLOR=1` or piped to a file
   (chalk auto-detects TTY/color support).
4. **Errors are friendly, not stack traces.** A human-readable message plus
   an actionable hint by default; raw stack traces only under
   `DEVMAN_DEBUG`.
5. **One command, one clear outcome.** Success ends in a ✔ line or a
   rendered table — never silence.

## Building Blocks

All rendering funnels through two small modules so colour/format decisions
live in one place:

- `src/cli/render.ts` — line-level primitives: `printSuccess`, `printInfo`,
  `printError`.
- `src/ui/statusTable.ts` — structured output: the status table and the
  single-service info table.

Adding new terminal output should extend these, not scatter
`console.log`/`chalk` calls through handlers.

## Vocabulary

| Element     | Style                                                                       | Example                                                  |
| ----------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| Success     | `chalk.green('✔')` + message, stdout                                        | `✔ Started 3 service(s).`                                |
| Info        | `chalk.cyan('ℹ')` + message, stdout                                         | `ℹ Daemon is not running.`                               |
| Error       | `chalk.red.bold('✖ Error')` + message, stderr                               | `✖ Error Unknown service: "web".`                        |
| Hint        | `  chalk.yellow('hint:')` + text, indented under the error                  | `  hint: Run devman status to list configured services.` |
| Debug cause | `chalk.dim(...)`, only under `DEVMAN_DEBUG`                                 | `  cause: <stack trace>`                                 |
| Spinner     | `ora(...)`, verb + ellipsis while pending, `.succeed()`/`.fail()` on settle | `⠋ Starting daemon…` → `✔ Daemon ready`                  |

### Errors

```
✖ Error Unknown service: "web".
  hint: Run `devman status` to list configured services.
```

Errors always come from a `DevmanError` subclass (`src/utils/errors.ts`) so
the message and hint are meaningful and stable. Never let a raw `Error` or a
JSON blob reach the terminal — wrap it (`toDevmanError`) first. Exit codes
follow `exitCodeFor`: `1` for a recognised `DevmanError`, `2` for anything
unexpected (bug, not user error).

### Spinners (ora)

- Text is a present-participle phrase ending in an ellipsis: `"Starting
daemon…"`, `"Stopping all services and daemon…"`.
- Update `spinner.text` mid-flight for multi-step actions instead of
  stacking multiple spinners (see `startDefault` updating text once the
  daemon pid is known).
- Always resolve with `.succeed(message)` or `.fail(message)` — never leave
  a spinner hanging, and never swallow the error after `.fail()`; rethrow so
  the CLI's error path and exit code still fire.

### Tables (cli-table3)

- Headers are bold, upper-case, single word per column:
  `SERVICE STATUS PID UPTIME RESTARTS HEALTH`.
- Column order goes coarse → fine: identity, then state, then process
  detail, then derived/health info.
- Empty/inapplicable cells render as `-`, never blank — a blank cell reads
  as a rendering bug, `-` reads as "not applicable" (e.g. `PID` for a
  stopped service, `UPTIME` for anything not `running`).
- `info <service>` reuses the same table primitive as a vertical key/value
  view rather than a bespoke layout, so the two views feel like one system.
- `devman list` (`renderRegistryTable`) is the one table that spans multiple
  `--home` directories at once: `HOME PID PROFILE SERVICES UPTIME`. An
  unreachable instance (pid alive, daemon not answering) still gets a row —
  `unreachable` in red — rather than being silently dropped, so a hung
  daemon is visible instead of invisible.

### Colour mapping

| Status/Health            | Colour |
| ------------------------ | ------ |
| `running` / `healthy`    | green  |
| `starting` / `stopping`  | yellow |
| `failed` / `unhealthy`   | red    |
| `stopped`                | gray   |
| `configured` / `unknown` | dim    |

Keep this mapping exhaustive whenever a new status or health value is added
— an unmapped value should still fall through to `dim`, never throw.

## Streaming Output (`devman log`)

Live log streaming (`follow: true`) writes each chunk as it arrives, one
line per `process.stdout.write`, with no buffering delay and no added
framing — the daemon-side `serviceLogger` already timestamps and tags
stream (stdout/stderr), so the CLI prints the chunk as-is. This keeps
`devman log <svc> | grep ...` well-behaved.

## Accessibility & Environment

- Respect `NO_COLOR` and non-TTY output automatically via `chalk`'s
  built-in detection — don't force colour codes.
- `-v/--verbose` and `DEVMAN_DEBUG` are the only ways to get noisier output
  (debug-level logger lines, error causes/stack traces); default output
  stays terse.
- Never assume a wide terminal: table columns are short, fixed-width labels
  (`running`, `healthy`, `12345`) rather than prose, so tables stay legible
  at 80 columns.

## Future: Interactive TUI

The roadmap includes a live-updating TUI (see ARCHITECTURE.md). When that
lands, it should reuse the same status/health colour mapping and column set
defined here so the static (`devman status`) and live views don't diverge
into two visual languages.

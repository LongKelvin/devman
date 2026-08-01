#!/usr/bin/env node
/**
 * `devman` CLI entry point.
 *
 * Responsibilities are deliberately thin: build the program, run it, and turn
 * any thrown error into a friendly message plus a non-zero exit code. All real
 * behaviour lives in injected handlers.
 */
import { buildProgram } from './program.js';
import { handlers } from './handlers.js';
import { exitCodeFor, printError } from './render.js';

async function main(): Promise<void> {
  const program = buildProgram(handlers);
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  printError(error);
  process.exitCode = exitCodeFor(error);
});

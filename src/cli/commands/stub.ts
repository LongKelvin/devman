/**
 * Phase 1 command placeholders.
 *
 * The CLI surface and option parsing are wired up now so the skeleton is
 * exercised and stable. Behaviour that requires the daemon (Phases 2–4) throws
 * a clear "not implemented yet" error rather than pretending to work, so the
 * build is never in a misleadingly-green state.
 */
import { DevmanError } from '../../utils/errors.js';

/** Raised by not-yet-implemented commands so failures are explicit. */
export function notImplemented(command: string): never {
  throw new DevmanError(
    'INTERNAL',
    `Command "${command}" is not implemented yet.`,
    { hint: 'This lands in a later implementation phase.' },
  );
}

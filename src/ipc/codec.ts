/**
 * Newline-delimited JSON framing.
 *
 * Each message is a single JSON object on its own line. This is simple, human
 * readable in logs, and independent of the underlying byte stream — which is
 * what keeps the transport replaceable. {@link NdjsonDecoder} buffers partial
 * reads and yields whole messages as they complete.
 */
import { DevmanError } from '../utils/errors.js';
import type { IpcMessage } from './protocol.js';

/** Encode a message as a single NDJSON line (including the trailing newline). */
export function encodeMessage(message: IpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Incremental decoder for a byte stream carrying NDJSON. Feed it chunks; it
 * returns any complete messages parsed from the accumulated buffer.
 */
export class NdjsonDecoder {
  private buffer = '';

  /** Append `chunk` and return every complete message now available. */
  push(chunk: string): IpcMessage[] {
    this.buffer += chunk;
    const messages: IpcMessage[] = [];
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) messages.push(this.parseLine(line));
      newlineIndex = this.buffer.indexOf('\n');
    }
    return messages;
  }

  private parseLine(line: string): IpcMessage {
    try {
      return JSON.parse(line) as IpcMessage;
    } catch (cause) {
      throw new DevmanError('IPC_ERROR', 'Received malformed IPC message.', {
        cause,
      });
    }
  }
}

import { describe, expect, it } from 'vitest';
import { encodeMessage, NdjsonDecoder } from '../../src/ipc/codec.js';
import { DevmanError } from '../../src/utils/errors.js';
import type { IpcRequest } from '../../src/ipc/protocol.js';

const request: IpcRequest = {
  id: 1,
  kind: 'request',
  method: 'ping',
  params: {},
};

describe('NDJSON codec', () => {
  it('round-trips a message', () => {
    const decoder = new NdjsonDecoder();
    const messages = decoder.push(encodeMessage(request));
    expect(messages).toEqual([request]);
  });

  it('buffers partial reads until a newline arrives', () => {
    const decoder = new NdjsonDecoder();
    const line = encodeMessage(request);
    const mid = Math.floor(line.length / 2);
    expect(decoder.push(line.slice(0, mid))).toEqual([]);
    expect(decoder.push(line.slice(mid))).toEqual([request]);
  });

  it('decodes several messages from one chunk', () => {
    const decoder = new NdjsonDecoder();
    const chunk = encodeMessage(request) + encodeMessage({ ...request, id: 2 });
    const messages = decoder.push(chunk);
    expect(messages.map((m) => (m as IpcRequest).id)).toEqual([1, 2]);
  });

  it('ignores blank lines', () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push('\n\n')).toEqual([]);
  });

  it('throws on malformed JSON', () => {
    const decoder = new NdjsonDecoder();
    expect(() => decoder.push('not json\n')).toThrow(DevmanError);
  });
});

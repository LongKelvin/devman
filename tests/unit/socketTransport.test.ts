/**
 * Unit tests for SocketServerTransport and SocketClientTransport.
 *
 * Platform-aware: named pipes are used on Windows, Unix domain sockets
 * elsewhere. Tests that rely on the socket being a real file (stale-file
 * cleanup, post-close deletion) are skipped on Windows where named pipes
 * are kernel objects rather than filesystem entries.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SocketClientTransport,
  SocketServerTransport,
} from '../../src/ipc/socketTransport.js';
import { DevmanError } from '../../src/utils/errors.js';
import { pathExists } from '../../src/utils/fs.js';
import type { IpcMessage } from '../../src/ipc/protocol.js';

let dir: string;

/** Servers to close in afterEach if a test fails mid-way. */
const serversToClose: SocketServerTransport[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-transport-'));
});

afterEach(async () => {
  for (const s of serversToClose.splice(0)) {
    await s.close().catch(() => {});
  }
  await rm(dir, { recursive: true, force: true });
});

/** Return a socket path unique to the current test and platform. */
function socketPath(name = 'test'): string {
  if (process.platform === 'win32') {
    // Named pipes on Windows: must live under \\.\pipe\
    return `\\\\.\\pipe\\devman-${name}-${process.pid}`;
  }
  return join(dir, `${name}.sock`);
}

// ─── Server lifecycle ────────────────────────────────────────────────────────

describe('SocketServerTransport', () => {
  it('exposes the address it was constructed with', async () => {
    const addr = socketPath('addr');
    const server = new SocketServerTransport(addr);
    serversToClose.push(server);
    await server.listen(() => {});
    expect(server.address).toBe(addr);
    await server.close();
  });

  it('close() before listen() is a safe no-op', async () => {
    const server = new SocketServerTransport(socketPath('no-start'));
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('removes a stale socket file before listening (POSIX only)', async () => {
    if (process.platform === 'win32') return;

    const addr = join(dir, 'stale.sock');
    // Simulate a file left by a previous crash
    await writeFile(addr, 'leftover');
    expect(await pathExists(addr)).toBe(true);

    const server = new SocketServerTransport(addr);
    serversToClose.push(server);
    // listen() must not throw even though the stale file exists
    await expect(server.listen(() => {})).resolves.toBeUndefined();
    await server.close();
  });

  it('removes the socket file when closed (POSIX only)', async () => {
    if (process.platform === 'win32') return;

    const addr = join(dir, 'cleanup.sock');
    const server = new SocketServerTransport(addr);
    await server.listen(() => {});
    expect(await pathExists(addr)).toBe(true);

    await server.close();
    expect(await pathExists(addr)).toBe(false);
  });
});

// ─── Client ──────────────────────────────────────────────────────────────────

describe('SocketClientTransport', () => {
  it('wraps a connection-refused error as DevmanError(IPC_ERROR)', async () => {
    const client = new SocketClientTransport(socketPath('no-server'));
    const err = await client.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DevmanError);
    expect((err as DevmanError).code).toBe('IPC_ERROR');
  });
});

// ─── Round-trip communication ─────────────────────────────────────────────────

describe('SocketServerTransport + SocketClientTransport round-trip', () => {
  it('client message arrives at the server', async () => {
    const addr = socketPath('roundtrip');
    const server = new SocketServerTransport(addr);
    serversToClose.push(server);

    const received: IpcMessage[] = [];
    await server.listen((conn) => {
      conn.onMessage((msg) => received.push(msg));
    });

    const client = new SocketClientTransport(addr);
    const conn = await client.connect();

    const msg: IpcMessage = {
      id: 1,
      kind: 'request',
      method: 'ping',
      params: {},
    };
    await conn.send(msg);
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ id: 1, kind: 'request', method: 'ping' });

    conn.close();
    await server.close();
  });

  it('server can reply to the client', async () => {
    const addr = socketPath('server-reply');
    const server = new SocketServerTransport(addr);
    serversToClose.push(server);

    await server.listen((serverConn) => {
      serverConn.onMessage(() => {
        const reply: IpcMessage = {
          id: 1,
          kind: 'response',
          ok: true,
          result: { pong: true },
        };
        void serverConn.send(reply);
      });
    });

    const clientConn = await new SocketClientTransport(addr).connect();
    const replies: IpcMessage[] = [];
    clientConn.onMessage((m) => replies.push(m));

    await clientConn.send({
      id: 1,
      kind: 'request',
      method: 'ping',
      params: {},
    });
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ kind: 'response', ok: true });

    clientConn.close();
    await server.close();
  });

  it('onClose fires on the server side when the client disconnects', async () => {
    const addr = socketPath('on-close');
    const server = new SocketServerTransport(addr);
    serversToClose.push(server);

    let serverSideClosed = false;
    await server.listen((conn) => {
      conn.onClose(() => {
        serverSideClosed = true;
      });
    });

    const conn = await new SocketClientTransport(addr).connect();
    conn.close();

    await new Promise<void>((r) => setTimeout(r, 150));
    expect(serverSideClosed).toBe(true);

    await server.close();
  });

  it('multiple clients can connect concurrently', async () => {
    const addr = socketPath('multi');
    const server = new SocketServerTransport(addr);
    serversToClose.push(server);

    const received: IpcMessage[] = [];
    await server.listen((conn) => {
      conn.onMessage((msg) => received.push(msg));
    });

    const c1 = await new SocketClientTransport(addr).connect();
    const c2 = await new SocketClientTransport(addr).connect();

    const ping: IpcMessage = { id: 1, kind: 'request', method: 'ping', params: {} };
    await c1.send(ping);
    await c2.send(ping);
    await new Promise<void>((r) => setTimeout(r, 150));

    expect(received).toHaveLength(2);

    c1.close();
    c2.close();
    await server.close();
  });
});

// ─── Named-pipe path format (Windows) ────────────────────────────────────────

describe('platform-specific socket path format', () => {
  it('Windows path matches the named-pipe namespace pattern', () => {
    if (process.platform !== 'win32') return;
    const path = socketPath('format-check');
    // All Windows named pipes start with \\.\pipe\
    expect(path).toMatch(/^\\\\\.\\\pipe\\/);
  });

  it('POSIX path is a regular filesystem path ending in .sock', () => {
    if (process.platform === 'win32') return;
    const path = socketPath('format-check');
    expect(path).toMatch(/\.sock$/);
    expect(path.startsWith('/')).toBe(true);
  });
});

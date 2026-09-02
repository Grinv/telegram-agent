import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BROKER_SCRIPT = join(__dirname, '..', '..', 'scripts', 'telegram-broker.mjs');

/** Starts a fake Telegram upstream on 127.0.0.1 that records the requests it receives. */
function startFakeUpstream(): Promise<{ server: Server; port: number; requests: { path: string; method: string }[] }> {
  const requests: { path: string; method: string }[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push({ path: req.url ?? '', method: req.method ?? '' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: [] }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

/** Spawns the broker and resolves once it logs that it's listening, extracting the bound port. */
function startBroker(env: Record<string, string>): Promise<{ child: ChildProcess; port: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BROKER_SCRIPT], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`broker did not start in time (stderr so far: ${stderr})`));
    }, 5000);

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = stderr.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ child, port: Number(match[1]) });
      }
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`broker exited early with code ${code} (stderr: ${stderr})`));
      }
    });
  });
}

test('broker substitutes the real token into the upstream path for allowlisted methods', async () => {
  const upstream = await startFakeUpstream();
  const { child, port } = await startBroker({
    TELEGRAM_BOT_TOKEN: 'REAL_SECRET_TOKEN',
    TELEGRAM_BROKER_PORT: '0',
    TELEGRAM_BROKER_UPSTREAM: `http://127.0.0.1:${upstream.port}`,
  });

  try {
    const response = await fetch(`http://127.0.0.1:${port}/botPLACEHOLDER/getUpdates?timeout=1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true, result: [] });

    assert.equal(upstream.requests.length, 1);
    assert.match(upstream.requests[0].path, /^\/botREAL_SECRET_TOKEN\/getUpdates\?timeout=1$/);
  } finally {
    child.kill();
    upstream.server.close();
  }
});

test('broker rejects methods outside the allowlist with 403', async () => {
  const upstream = await startFakeUpstream();
  const { child, port } = await startBroker({
    TELEGRAM_BOT_TOKEN: 'REAL_SECRET_TOKEN',
    TELEGRAM_BROKER_PORT: '0',
    TELEGRAM_BROKER_UPSTREAM: `http://127.0.0.1:${upstream.port}`,
  });

  try {
    const response = await fetch(`http://127.0.0.1:${port}/botPLACEHOLDER/deleteWebhook`, { method: 'POST' });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(upstream.requests.length, 0);
  } finally {
    child.kill();
    upstream.server.close();
  }
});

test('broker returns 404 for paths that are not /bot<...>/<method>', async () => {
  const upstream = await startFakeUpstream();
  const { child, port } = await startBroker({
    TELEGRAM_BOT_TOKEN: 'REAL_SECRET_TOKEN',
    TELEGRAM_BROKER_PORT: '0',
    TELEGRAM_BROKER_UPSTREAM: `http://127.0.0.1:${upstream.port}`,
  });

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 404);
  } finally {
    child.kill();
    upstream.server.close();
  }
});

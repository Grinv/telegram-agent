import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { getGlobalDispatcher, setGlobalDispatcher, type Agent } from 'undici';
import { configureFetchTimeouts, FETCH_TIMEOUT_MS } from '../../src/llm/configure-fetch-timeouts.js';

test('constructs an Agent with headersTimeout and bodyTimeout both set to the given timeout, and installs it via setDispatcher', () => {
  const constructed: Array<{ headersTimeout: number; bodyTimeout: number }> = [];
  const dispatched: unknown[] = [];
  class FakeAgent {
    headersTimeout: number;
    bodyTimeout: number;
    constructor(options: { headersTimeout: number; bodyTimeout: number }) {
      this.headersTimeout = options.headersTimeout;
      this.bodyTimeout = options.bodyTimeout;
      constructed.push(options);
    }
  }

  configureFetchTimeouts(
    FETCH_TIMEOUT_MS,
    (dispatcher) => dispatched.push(dispatcher),
    FakeAgent as unknown as new (options: { headersTimeout: number; bodyTimeout: number }) => Agent,
  );

  assert.equal(constructed.length, 1);
  assert.equal(constructed[0].headersTimeout, FETCH_TIMEOUT_MS);
  assert.equal(constructed[0].bodyTimeout, FETCH_TIMEOUT_MS);
  assert.equal(dispatched.length, 1);
  assert.ok(dispatched[0] instanceof FakeAgent);
});

test('FETCH_TIMEOUT_MS is strictly greater than 600_000ms (double undici\'s own 300_000ms default)', () => {
  assert.ok(FETCH_TIMEOUT_MS > 600_000);
});

test('a slow but legitimate request outlasting a transport-internal default succeeds once the dispatcher timeout is raised above it', async () => {
  // undici's internal timer wheel has ~1s resolution, so timeouts well under that
  // (e.g. 150ms) don't fire deterministically before a response can race them; the
  // delay/timeouts below are sized to stay clear of that granularity.
  const RESPONSE_DELAY_MS = 2000;
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    }, RESPONSE_DELAY_MS);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/`;

  const originalDispatcher = getGlobalDispatcher();
  try {
    configureFetchTimeouts(50);
    await assert.rejects(() => fetch(url));

    configureFetchTimeouts(5000);
    const response = await fetch(url);
    assert.equal(response.ok, true);
    assert.equal(await response.text(), 'ok');
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

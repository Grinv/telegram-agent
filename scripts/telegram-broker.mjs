#!/usr/bin/env node
// The Telegram Bot API embeds the bot token in the request path, but the
// microVM sandbox boundary can only inject secrets into HTTP headers, not
// URLs. This broker fills that gap: it runs on the host, outside the
// isolation boundary, holds the real token, and rewrites the placeholder
// path segment the sandboxed bot sends into the real Telegram URL. The bot
// itself never sees the token.

import { createServer } from 'node:http';

try {
  process.loadEnvFile();
} catch {
  // .env is optional - environment variables may be supplied directly.
}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error(
    'TELEGRAM_BOT_TOKEN is required but was not set (add it to .env or the environment)'
  );
  process.exit(1);
}

const HOST = '127.0.0.1'; // never 0.0.0.0 - the broker must not be reachable outside the host
const rawPort = process.env.TELEGRAM_BROKER_PORT ?? '8081';
const port = Number(rawPort);
// Port 0 is allowed and means "any free port" - the tests rely on it.
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`TELEGRAM_BROKER_PORT must be an integer between 0 and 65535, got "${rawPort}"`);
  process.exit(1);
}
const upstreamBase = process.env.TELEGRAM_BROKER_UPSTREAM ?? 'https://api.telegram.org';

// Least-privilege allowlist: the bot only ever calls these Telegram Bot API
// methods (long-poll for updates, send replies). Extend this set
// deliberately if the bot starts relying on more of the API.
const ALLOWED_METHODS = new Set(['getUpdates', 'sendMessage']);

const PATH_PATTERN = /^\/bot[^/]*\/([^/]+)$/;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${port}`);
  const match = url.pathname.match(PATH_PATTERN);

  if (!match) {
    sendJson(res, 404, { ok: false, description: 'Not Found' });
    return;
  }

  const method = match[1];
  if (!ALLOWED_METHODS.has(method)) {
    console.error(`telegram-broker: ${req.method} ${method} -> 403 (not in allowlist)`);
    sendJson(res, 403, { ok: false, description: `Method "${method}" is not permitted by the broker` });
    return;
  }

  const isBodyless = req.method === 'GET' || req.method === 'HEAD';
  const body = isBodyless ? undefined : await readRequestBody(req);
  const headers = {};
  if (req.headers['content-type']) {
    headers['Content-Type'] = req.headers['content-type'];
  }

  // The token is inserted here, at the last possible moment, and only into
  // the outgoing upstream URL - never logged, never echoed back.
  const upstreamUrl = `${upstreamBase}/bot${token}/${method}${url.search}`;

  try {
    // No AbortSignal/timeout here on purpose: getUpdates is long polling and
    // can legitimately hang for tens of seconds waiting on Telegram.
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    });

    const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
    console.error(`telegram-broker: ${req.method} ${method} -> ${upstreamResponse.status}`);
    res.writeHead(upstreamResponse.status, {
      'Content-Type': upstreamResponse.headers.get('content-type') ?? 'application/json',
    });
    res.end(responseBody);
  } catch (error) {
    console.error(`telegram-broker: ${req.method} ${method} -> upstream request failed: ${error.message}`);
    sendJson(res, 502, { ok: false, description: 'Upstream request to Telegram failed' });
  }
});

server.listen(port, HOST, () => {
  const actualPort = server.address().port;
  console.error(`telegram-broker: listening on ${HOST}:${actualPort}`);
});

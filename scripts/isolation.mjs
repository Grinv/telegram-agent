#!/usr/bin/env node
// Provisions and drives the isolated deployment: the bot, its container
// runtime and its per-tool-call sandboxes all run inside a hardware-isolated
// microVM ("the boundary") managed by Docker Sandboxes (`sbx`).
//
// Everything the boundary is allowed to see or reach is declared here, so the
// grants are reviewable in one place rather than scattered across a runbook:
// three host directories, two host ports, and nothing else. See DEPLOYMENT.md
// for the operator-facing walkthrough and openspec/specs/agent-isolation.
//
// Usage: node scripts/isolation.mjs <provision|start|stop|status|destroy>

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

try {
  process.loadEnvFile();
} catch {
  // .env is optional - environment variables may be supplied directly.
}

const SANDBOX = process.env.ISOLATION_SANDBOX_NAME ?? 'tg-agent';
const TEMPLATE = process.env.ISOLATION_TEMPLATE ?? 'telegram-agent-boundary:node24';
const BROKER_PORT = process.env.TELEGRAM_BROKER_PORT ?? '8081';
const OLLAMA_PORT = process.env.ISOLATION_OLLAMA_PORT ?? '11434';
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? 'telegram-agent-sandbox';

// The repository path is mirrored inside the boundary, so host and guest
// paths for a granted directory are identical.
const ROOT = process.cwd();
const STAGING = join(ROOT, '.sbx');
const IMAGE_TAR = join(STAGING, 'sandbox-image.tar');

// Host directories the boundary may see, in `sbx create` order. The first one
// is the primary workspace and must be read/write.
const WORKSPACES = ['./data', './dist:ro', './.sbx:ro'];

// Host ports the boundary may reach. Named as `localhost:<port>` in the
// policy; addressed as `host.docker.internal:<port>` from inside.
const ALLOWED_HOST_PORTS = [`localhost:${OLLAMA_PORT}`, `localhost:${BROKER_PORT}`];

// The `shell` kit contributes its own allow rule at sandbox-create time. It is
// not editable, so it is narrowed by a local deny instead - a local deny can
// only narrow egress, never widen it.
const DENIED_HOSTS = ['openrouter.ai'];

// The bot's environment inside the boundary. TELEGRAM_BOT_TOKEN is a
// deliberate non-secret: the real token is held by the host-side broker
// (scripts/telegram-broker.mjs) and never enters the boundary.
const BOT_ENV = {
  TELEGRAM_BOT_TOKEN: 'placeholder-held-by-host-broker',
  TELEGRAM_API_BASE_URL: `http://host.docker.internal:${BROKER_PORT}`,
  LLM_PROVIDER: process.env.LLM_PROVIDER ?? 'ollama',
  OLLAMA_BASE_URL: `http://host.docker.internal:${OLLAMA_PORT}`,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? 'qwen2.5',
  SANDBOX_IMAGE,
  STATS_DB_PATH: join(ROOT, 'data', 'stats.db'),
};
for (const key of [
  'CLASSIFIER_MODEL',
  'ROUTER_FALLBACK_MODEL',
  'TOOL_USE_MAX_ITERATIONS',
  'LLM_TIMEOUT_MS',
  'CLASSIFIER_TIMEOUT_MS',
  'SANDBOX_TIMEOUT_MS',
]) {
  if (process.env[key]) BOT_ENV[key] = process.env[key];
}

const BOT_LOG = join(ROOT, 'data', 'bot.log');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function capture(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function sandboxExists() {
  const { ok, out } = capture('sbx', ['ls']);
  return ok && out.split('\n').some((line) => line.split(/\s+/)[0] === SANDBOX);
}

function requireTemplate() {
  const { out } = capture('sbx', ['template', 'ls']);
  if (!out.includes(TEMPLATE.split(':')[0])) {
    console.error(
      `Template "${TEMPLATE}" is not loaded into the sandbox runtime.\n` +
        `Build and load it first (see DEPLOYMENT.md):\n` +
        `  docker build -t ${TEMPLATE} isolation\n` +
        `  docker save ${TEMPLATE} -o /tmp/boundary.tar && sbx template load /tmp/boundary.tar`
    );
    process.exit(1);
  }
}

function applyPolicy() {
  for (const resource of ALLOWED_HOST_PORTS) {
    // Remove first so re-provisioning does not stack duplicate rules.
    capture('sbx', ['policy', 'rm', 'network', '--sandbox', SANDBOX, '--resource', resource]);
    run('sbx', ['policy', 'allow', 'network', '--sandbox', SANDBOX, resource]);
  }
  for (const resource of DENIED_HOSTS) {
    capture('sbx', ['policy', 'rm', 'network', '--sandbox', SANDBOX, '--resource', resource]);
    run('sbx', ['policy', 'deny', 'network', '--sandbox', SANDBOX, resource]);
  }
}

function execInside(script, detached = false) {
  const args = ['exec'];
  if (detached) args.push('-d');
  args.push(SANDBOX, '--', 'sh', '-c', script);
  return args;
}

function provision() {
  requireTemplate();

  console.log('==> Building the bot and the sandbox image on the host');
  run('npm', ['run', 'build']);
  run('npm', ['run', 'sandbox:build']);

  mkdirSync(STAGING, { recursive: true });
  mkdirSync(join(ROOT, 'data'), { recursive: true });

  // The sandbox image is carried in as a tar rather than pulled from inside,
  // so no registry host has to be added to the boundary's allow list.
  console.log(`==> Exporting ${SANDBOX_IMAGE} to ${IMAGE_TAR}`);
  run('docker', ['save', `${SANDBOX_IMAGE}:latest`, '-o', IMAGE_TAR]);

  if (sandboxExists()) {
    console.log(`==> Boundary "${SANDBOX}" already exists, keeping it`);
  } else {
    console.log(`==> Creating boundary "${SANDBOX}"`);
    const envArgs = Object.entries(BOT_ENV).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    run('sbx', ['create', 'shell', '--name', SANDBOX, '-t', TEMPLATE, ...envArgs, ...WORKSPACES]);
  }

  console.log('==> Applying network policy');
  applyPolicy();

  console.log('==> Loading the sandbox image into the boundary runtime');
  run('sbx', execInside(`docker load -i ${JSON.stringify(IMAGE_TAR)}`));

  console.log('\nProvisioned. Start the host-side broker, then the bot:');
  console.log('  npm run isolated:broker   # separate terminal; holds the real token');
  console.log('  npm run isolated:start');
}

function start() {
  if (!sandboxExists()) {
    console.error(`Boundary "${SANDBOX}" does not exist. Run: npm run isolated:provision`);
    process.exit(1);
  }
  const { ok } = capture('curl', ['-s', '-m', '3', '-o', '/dev/null', `http://127.0.0.1:${BROKER_PORT}/`]);
  if (!ok) {
    console.error(
      `The Telegram broker is not answering on 127.0.0.1:${BROKER_PORT}.\n` +
        'It holds the token the bot cannot hold itself. Start it first: npm run isolated:broker'
    );
    process.exit(1);
  }
  console.log(`==> Starting the bot inside "${SANDBOX}" (log: data/bot.log)`);
  // The environment is re-applied on every start, not just at create time, so
  // changing OLLAMA_MODEL or a timeout does not mean recreating the boundary.
  const exports = Object.entries(BOT_ENV)
    .map(([k, v]) => `export ${k}=${JSON.stringify(String(v))}`)
    .join('; ');
  run('sbx', execInside(`cd ${JSON.stringify(ROOT)} && ${exports} && exec node dist/index.js >> ${JSON.stringify(BOT_LOG)} 2>&1`, true));
  console.log('Started. Follow it with: tail -f data/bot.log');
}

function stop() {
  // The bracket around the first character keeps the pattern from matching the
  // `sh -c` command line that carries it, which would make pkill kill itself.
  capture('sbx', execInside('pkill -f "[n]ode dist/index.js" || true'));
  console.log(`Bot stopped inside "${SANDBOX}". The boundary itself is still running (sbx stop ${SANDBOX} to suspend it).`);
}

function status() {
  run('sbx', ['ls']);
  console.log('\n--- policy rules in force for this boundary ---');
  run('sbx', ['policy', 'ls']);
  console.log('\n--- processes inside ---');
  run('sbx', execInside('ps -eo user,pid,args | grep -E "node|dockerd" | grep -v grep || echo "(no bot process)"'));
  if (existsSync(BOT_LOG)) {
    console.log('\n--- last lines of data/bot.log ---');
    run('tail', ['-5', BOT_LOG]);
  }
}

function destroy() {
  run('sbx', ['rm', '-f', SANDBOX]);
  console.log(
    `Boundary "${SANDBOX}" destroyed. Its container runtime, images and writable state went with it;\n` +
      'the granted host directories (data/, dist/, .sbx/) are untouched.'
  );
}

const commands = { provision, start, stop, status, destroy };
const command = process.argv[2];
if (!Object.hasOwn(commands, command ?? '')) {
  console.error(`Usage: node scripts/isolation.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
commands[command]();

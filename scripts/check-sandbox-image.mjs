#!/usr/bin/env node
// Verifies the sandbox Docker image exists locally before `docker compose up`
// starts the bot. Run as a pre-step of the `docker:up` npm script.

import { execFileSync } from 'node:child_process';

try {
  process.loadEnvFile();
} catch {
  // .env is optional - environment variables may be supplied directly.
}

const image = process.env.SANDBOX_IMAGE ?? 'telegram-agent-sandbox';

try {
  execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
} catch {
  console.error(
    `Sandbox image "${image}" not found locally. Build it first: npm run sandbox:build`
  );
  process.exit(1);
}

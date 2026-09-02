#!/usr/bin/env node
// The isolated deployment grants the boundary `dist/` alone, not the repository
// root, so the root package.json - and its "type": "module" - is not visible
// inside. Without it Node reads dist/*.js as CommonJS and the bot fails to
// start. This writes the smallest package.json that makes dist/ self-contained.

import { writeFileSync } from 'node:fs';

writeFileSync('dist/package.json', `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

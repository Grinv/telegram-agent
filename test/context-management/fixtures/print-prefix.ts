// Fixture invoked as a standalone process by prefix.test.ts, to prove
// byte-identity holds across separate process runs (e.g. `Map` iteration
// order), not just within one already-warm process.
import { buildRequestPrefix } from '../../../src/context-management/prefix.js';
import { createDefaultToolRegistry } from '../../../src/tools/index.js';

const registry = createDefaultToolRegistry();
const prefix = buildRequestPrefix(registry, undefined);
process.stdout.write(JSON.stringify(prefix));

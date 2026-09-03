import { createConnector, ConnectorNotConfiguredError } from './connector-registry.js';
import { configureFetchTimeouts } from './configure-fetch-timeouts.js';
import type { LlmRequest, LlmResult } from './types.js';

// Node's global fetch is backed by undici, whose default Agent caps headersTimeout/
// bodyTimeout at 300_000ms regardless of this project's own LLM_TIMEOUT_MS. Without
// this, a configured timeout above ~300s is silently capped and fails with
// PROVIDER_ERROR instead of ever reaching the outer kill-timer's TIMEOUT.
configureFetchTimeouts();

interface RunnerRequest {
  request: LlmRequest;
  provider: string;
}

async function run(request: RunnerRequest): Promise<LlmResult> {
  try {
    const connector = createConnector(request.provider);
    return await connector.callLlm(request.request);
  } catch (error) {
    if (error instanceof ConnectorNotConfiguredError) {
      return { ok: false, reason: 'NOT_CONFIGURED', message: error.message };
    }
    return {
      ok: false,
      reason: 'PROVIDER_ERROR',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

process.on('message', (request: RunnerRequest) => {
  run(request).then((result) => {
    if (!process.send) {
      process.exit(1);
      return;
    }
    process.send(result, () => process.exit(result.ok ? 0 : 1));
  });
});

import { createConnector, ConnectorNotConfiguredError } from './connector-registry.js';
import type { LlmRequest, LlmResult } from './types.js';

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

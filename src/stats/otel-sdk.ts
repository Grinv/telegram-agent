import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { OtelStatsRecorder } from './otel-exporter.js';
import { FailureTrackingSpanExporter } from './otel-failure-tracking-exporter.js';
import type { PriceTable } from './pricing.js';
import type { StatsRecorder } from './types.js';

/**
 * Appends the OTLP traces resource path to a bare `OTEL_EXPORTER_OTLP_ENDPOINT`,
 * mirroring the OTLP spec's own handling of the non-signal-specific endpoint
 * variable (see `@opentelemetry/otlp-exporter-base`'s
 * `getNonSpecificUrlFromEnv`) - so `http://localhost:4318` and
 * `http://localhost:4318/` both resolve to `.../v1/traces`.
 */
function tracesUrl(endpoint: string): string {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  return `${base}v1/traces`;
}

export interface OtelExportConfig {
  endpoint: string;
  storePrompts: boolean;
  priceTable: PriceTable;
}

/**
 * Builds the OTel SDK plumbing (resource, batch processor, OTLP HTTP
 * exporter) and returns a `StatsRecorder` backed by it. Only called when an
 * endpoint is configured (see `src/index.ts`) - with no endpoint, none of
 * this is constructed and nothing starts (see openspec/specs/agent-stats/spec.md
 * - "Export is off unless an operator configures a destination").
 *
 * Export is batched and non-blocking, and the queue drops spans rather than
 * growing when full - both are `BatchSpanProcessor`'s default behaviour
 * (`maxQueueSize`, batched async flush), not custom logic (see design.md -
 * Decisions, "Batched, non-blocking export").
 */
export function createOtelExportRecorder(config: OtelExportConfig): { recorder: StatsRecorder; shutdown: () => Promise<void> } {
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'telegram-agent' });
  const exporter = new FailureTrackingSpanExporter(new OTLPTraceExporter({ url: tracesUrl(config.endpoint) }));
  const processor = new BatchSpanProcessor(exporter);
  const provider = new BasicTracerProvider({ resource, spanProcessors: [processor] });
  const tracer = provider.getTracer('telegram-agent');

  return {
    recorder: new OtelStatsRecorder(tracer, config.storePrompts, config.priceTable),
    shutdown: () => provider.shutdown(),
  };
}

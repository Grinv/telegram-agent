import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { logger } from '../logger.js';

/**
 * Wraps a `SpanExporter` so export failures are logged once on the
 * unreachable -> failing transition and once on recovery, rather than once
 * per failed export batch - a destination that stays down for many messages
 * must not flood the log (see openspec/specs/agent-stats/spec.md - "Export
 * destination stays down"). Failures are otherwise swallowed: the result is
 * still passed to `resultCallback` so the underlying `BatchSpanProcessor`
 * behaves exactly as it would without this wrapper, but nothing here throws.
 */
export class FailureTrackingSpanExporter implements SpanExporter {
  private failing = false;

  constructor(private readonly delegate: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.delegate.export(spans, (result) => {
      if (result.code === ExportResultCode.SUCCESS) {
        if (this.failing) {
          this.failing = false;
          logger.info('Stats: trace export destination recovered');
        }
      } else if (!this.failing) {
        this.failing = true;
        logger.warn('Stats: trace export destination unreachable or rejecting spans; suppressing further failure logs until it recovers', {
          error: result.error?.message,
        });
      }
      resultCallback(result);
    });
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush ? this.delegate.forceFlush() : Promise.resolve();
  }
}

import { classifyModel, type CallLlm } from './classifier.js';
import type { ModelEntry, Router, RoutingDecision } from './types.js';

const DEFAULT_CLASSIFIER_TIMEOUT_MS = 5000;

export interface CreateRouterDeps {
  models: ModelEntry[];
  callLlm: CallLlm;
  classifierModel?: string;
  fallbackModel?: string;
  classifierTimeoutMs?: number;
}

function bySizeAsc(a: ModelEntry, b: ModelEntry): number {
  return a.parameterSize - b.parameterSize;
}

function bySizeDesc(a: ModelEntry, b: ModelEntry): number {
  return b.parameterSize - a.parameterSize;
}

function autoSelectFallback(models: ModelEntry[]): string {
  const toolCapable = models.filter((m) => m.supportsTools).sort(bySizeDesc);
  if (toolCapable.length > 0) return toolCapable[0].name;
  return [...models].sort(bySizeDesc)[0].name;
}

/**
 * Resolves the classifier and fallback model names that `createRouter` would
 * use for `models`, applying the same overrides/auto-selection rules.
 * Exposed separately so callers (e.g. startup logging) can report the
 * decision without duplicating the selection logic.
 */
export function selectClassifierAndFallback(
  models: ModelEntry[],
  classifierModelOverride?: string,
  fallbackModelOverride?: string,
): { classifierModel: string; fallbackModel: string } {
  return {
    classifierModel: classifierModelOverride ?? [...models].sort(bySizeAsc)[0].name,
    fallbackModel: fallbackModelOverride ?? autoSelectFallback(models),
  };
}

/**
 * Builds a `Router` from discovered models, auto-selecting the classifier
 * (smallest model) and fallback (largest tool-capable model, or largest
 * overall) unless overridden. Returns `null` when there's nothing to route
 * between (0 or 1 discovered models) — routing is then skipped entirely.
 */
export function createRouter(deps: CreateRouterDeps): Router | null {
  const { models, callLlm } = deps;

  if (models.length < 2) {
    return null;
  }

  const { classifierModel, fallbackModel } = selectClassifierAndFallback(models, deps.classifierModel, deps.fallbackModel);
  const classifierTimeoutMs = deps.classifierTimeoutMs ?? DEFAULT_CLASSIFIER_TIMEOUT_MS;

  return {
    async route(message: string): Promise<RoutingDecision> {
      const { model, usage, failureReason } = await classifyModel(message, models, {
        callLlm,
        classifierModel,
        timeoutMs: classifierTimeoutMs,
      });

      if (model === null) {
        return {
          model: fallbackModel,
          source: 'fallback',
          reason: failureReason === 'TIMEOUT' ? 'timeout' : failureReason ? 'classifier_error' : 'unrecognized',
          classifierModel,
          ...(usage ? { classifierUsage: usage } : {}),
        };
      }

      return {
        model,
        source: 'classifier',
        classifierModel,
        ...(usage ? { classifierUsage: usage } : {}),
      };
    },
  };
}

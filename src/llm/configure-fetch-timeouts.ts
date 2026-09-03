import { Agent, setGlobalDispatcher } from 'undici';

/**
 * Backstop ceiling for fetch's transport-level timeouts, set generously above any
 * LLM_TIMEOUT_MS/CLASSIFIER_TIMEOUT_MS value this system expects an operator to
 * configure, so raising those in .env never silently reintroduces undici's default
 * 300_000ms cap at a new ceiling.
 */
export const FETCH_TIMEOUT_MS = 3_600_000;

/**
 * Raises fetch's underlying undici dispatcher timeouts so a configured
 * LLM_TIMEOUT_MS/CLASSIFIER_TIMEOUT_MS above undici's 300_000ms default is actually
 * honored instead of being silently capped. setDispatcher/AgentCtor are injectable so
 * tests can observe what was constructed without depending on undici's internals.
 */
export function configureFetchTimeouts(
  timeoutMs = FETCH_TIMEOUT_MS,
  setDispatcher: (dispatcher: Agent) => void = setGlobalDispatcher,
  AgentCtor: new (options: { headersTimeout: number; bodyTimeout: number }) => Agent = Agent,
): void {
  setDispatcher(new AgentCtor({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs }));
}

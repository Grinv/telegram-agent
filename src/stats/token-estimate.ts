/**
 * Estimates a token count from text length. Providers in use here (Ollama)
 * do not tokenize tool results, prompt-category slices, or repeated-input
 * measurements independently of a full request, so those counts have to be
 * derived rather than read. This is a rough, deterministic estimate (~4
 * characters per token, the commonly cited average for English text) — not a
 * real tokenizer. It exists to be applied consistently across calls so
 * before/after comparisons are meaningful, not to be an accurate absolute
 * count.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

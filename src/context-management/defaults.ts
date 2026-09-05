/**
 * Default limits for `context-management`. Centralized so `src/config.ts`
 * (env var resolution) and call sites that construct their dependencies
 * directly (e.g. tests, `benchmark/run.ts`) agree on the same numbers
 * without importing from each other.
 */

/**
 * Max size (characters) a single tool result may reach before it is
 * truncated (see `src/context-management/tool-result-limit.ts`). No tool
 * result in the benchmark baseline exceeds 462 characters; this bound exists
 * for unbounded real-world results (`execute_command`, `read_file`), not to
 * trim the benchmark - see openspec/changes/add-token-optimizations/notes.md.
 */
export const DEFAULT_TOOL_RESULT_MAX_BYTES = 8000;

/**
 * Conversation size (estimated tokens, see `src/stats/token-estimate.ts`)
 * above which a request is sent compacted rather than in full (see
 * `src/context-management/conversation-compaction.ts`). The longest
 * conversation observed anywhere - benchmark or real bot usage - is 181
 * estimated tokens; this threshold is set far above any observed length so
 * compaction never engages on that workload and only fires on a
 * genuinely long-running chat. See notes.md section 4.7.
 */
export const DEFAULT_CONVERSATION_COMPACTION_THRESHOLD = 4000;

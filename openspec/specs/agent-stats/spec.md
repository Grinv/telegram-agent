## Purpose

Records agent operation statistics (message latency, per-LLM-call token usage by model, tool-call latency and results) into a local SQLite database, so the user can measure which models spend how many tokens, compare before/after performance, and generate reports — all without external dependencies or leaking confidential data to the repository.

## Requirements

### Requirement: Statistics are persisted to a local SQLite database
The system SHALL write agent operation statistics to a local SQLite database file, using Node's built-in `node:sqlite` module (no external dependencies). The database file SHALL reside under a `data/` directory that is excluded from version control, so confidential usage data never enters the repository.

#### Scenario: Database file is created on first write
- **WHEN** the stats recorder receives its first record and the database file does not exist
- **THEN** the file is created (with the schema) at the configured path (default `data/stats.db`) and the record is written

#### Scenario: Database file is gitignored
- **WHEN** the user runs `git status` after stats have been recorded
- **THEN** the `data/` directory and `data/stats.db` file do not appear as untracked or modified files

### Requirement: Per-message statistics are recorded
The system SHALL record one row per processed message, including: timestamp, chat ID, total latency (ms), number of loop iterations, number of tool calls, and success/failure status.

#### Scenario: Successful message processing
- **WHEN** a message is processed successfully (LLM returns a final answer, reply is sent)
- **THEN** a row is written to the `messages` table with `ok=1`, the total latency from receipt to reply, the iteration count, and the tool call count

#### Scenario: Failed message processing
- **WHEN** a message fails (inference error, max iterations, unexpected error)
- **THEN** a row is written to the `messages` table with `ok=0`, the latency up to the failure point, and the failure reason

### Requirement: Per-LLM-call statistics are recorded with model and tokens
The system SHALL record one row per LLM call, including: the model used, the number of prompt tokens, the number of completion tokens, the latency (ms), the role of the call (`main`, `classifier`, or `subagent`), and success/failure. Token counts SHALL be read from the `usage` field on `LlmResult` (populated by the Ollama connector from `prompt_eval_count`/`eval_count`), not estimated.

#### Scenario: LLM call with token usage
- **WHEN** an LLM call completes and `LlmResult.usage` is present
- **THEN** a row is written to the `llm_calls` table with the model name, `prompt_tokens` and `completion_tokens` from the usage field, the latency, and `role="main"`

#### Scenario: LLM call without token usage
- **WHEN** an LLM call completes and `LlmResult.usage` is absent (e.g. stub connector)
- **THEN** a row is written with `prompt_tokens=0` and `completion_tokens=0` (not null), so aggregations still work

### Requirement: Per-tool-call statistics are recorded
The system SHALL record one row per tool call executed, including: the tool name, the arguments (as JSON), the latency (ms), success/failure, and the result length.

#### Scenario: Tool call executed
- **WHEN** a tool call is executed during the loop
- **THEN** a row is written to the `tool_calls` table with the tool name, the arguments as a JSON string, the execution latency, `ok` flag, and the length of the result output

### Requirement: Markdown report generation
The system SHALL provide a command (`npm run stats:report`) that reads the SQLite database and generates a Markdown report file containing: per-model token totals (input, output, total), per-role token breakdown, average latency per model, overall success rate, and tool usage summary. The report file SHALL be written under `data/` (gitignored).

#### Scenario: Report generation with data
- **WHEN** the user runs `npm run stats:report` and the database contains recorded statistics
- **THEN** a Markdown file is generated at `data/stats-report.md` (gitignored) containing tables with per-model token totals, per-role breakdown, latency averages, success rate, and tool usage

#### Scenario: Report generation with empty database
- **WHEN** the user runs `npm run stats:report` and the database is empty or has no recorded statistics
- **THEN** a Markdown file is generated with a "No data" message, and the command exits successfully

### Requirement: Stats recording does not block the orchestrator
The system SHALL write statistics asynchronously (fire-and-forget) so that a slow disk write or database lock does not delay message processing. If a stats write fails, the failure SHALL be logged but SHALL NOT cause the message handling to fail.

#### Scenario: Database write fails
- **WHEN** a stats write fails (e.g. disk full, database locked)
- **THEN** the error is logged as a warning and the message handling continues normally (the reply is still sent)

### Requirement: Schema changes are applied via versioned migrations that preserve existing data
The system SHALL track the stats database's schema version and, whenever the database is opened, SHALL apply any pending migrations in order so the schema matches the version expected by the running code. Applying migrations SHALL preserve all existing rows in `messages`, `llm_calls`, and `tool_calls` — a schema change SHALL NOT require deleting or recreating the database file to pick up the new schema.

#### Scenario: Fresh database is created at the latest schema version
- **WHEN** the stats database file does not exist and the recorder or reporter opens it for the first time
- **THEN** the database is created with all tables at the latest schema version, and its tracked version is set to the latest

#### Scenario: Existing database is upgraded without data loss
- **WHEN** the stats database file exists at an older schema version and a newer version of the code (with additional migrations) opens it
- **THEN** the pending migrations are applied in order, existing rows in `messages`, `llm_calls`, and `tool_calls` remain intact, and the tracked version is updated to the latest

#### Scenario: Database is already at the latest schema version
- **WHEN** the stats database is opened and its tracked version already matches the latest available migration
- **THEN** no migration is applied and the existing data is left untouched

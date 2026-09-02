CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       TEXT NOT NULL,        -- ISO 8601
  chat_id         INTEGER NOT NULL,
  prompt_text     TEXT,                 -- may be null for privacy mode
  reply_text      TEXT,
  total_ms        INTEGER NOT NULL,
  iterations      INTEGER NOT NULL DEFAULT 0,
  tool_calls      INTEGER NOT NULL DEFAULT 0,
  ok              INTEGER NOT NULL,     -- 0 or 1
  reason          TEXT                  -- failure reason, null on success
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL REFERENCES messages(id),
  call_index      INTEGER NOT NULL,     -- 0, 1, 2... within the message
  role            TEXT NOT NULL,        -- "main" | "classifier" | "subagent"
  model           TEXT NOT NULL,
  prompt_tokens   INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL,
  ok              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL REFERENCES messages(id),
  llm_call_id     INTEGER REFERENCES llm_calls(id), -- nullable: tool calls are linked to the message, may or may not link to an llm_call
  tool_name       TEXT NOT NULL,
  args_json       TEXT NOT NULL,
  latency_ms      INTEGER NOT NULL,
  ok              INTEGER NOT NULL,
  result_len      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS turns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id         INTEGER NOT NULL,
  role            TEXT NOT NULL,        -- "user" | "assistant"
  content         TEXT NOT NULL,
  sender_id       INTEGER,              -- Telegram user id; NULL for assistant turns
  sender_name     TEXT,                 -- display name; NULL for assistant turns
  created_at      INTEGER NOT NULL      -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_turns_chat_id ON turns (chat_id);

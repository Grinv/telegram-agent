## ADDED Requirements

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

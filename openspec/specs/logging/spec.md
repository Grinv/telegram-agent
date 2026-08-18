## Purpose

Provides structured, human-readable console logging with severity and timing information, and ensures unexpected process-level errors are captured rather than crashing silently.

## Requirements

### Requirement: Structured log entries
The system SHALL emit log entries that include a timestamp, a severity level, and a message, and SHALL visually distinguish severity levels using console text coloring.

#### Scenario: Informational event logged
- **WHEN** a normal operational event occurs (e.g., message received, reply sent)
- **THEN** a log entry is emitted showing the timestamp, an info-level indicator, and a description of the event

#### Scenario: Error event logged
- **WHEN** an error occurs (e.g., inference failure, timeout)
- **THEN** a log entry is emitted showing the timestamp, an error-level indicator, and a description distinguishable at a glance from info-level entries

### Requirement: Uncaught exceptions are captured
The system SHALL install top-level handlers for uncaught exceptions and unhandled promise rejections so they are logged with sufficient detail instead of terminating the process with an unlogged crash.

#### Scenario: Unhandled rejection occurs
- **WHEN** a promise rejection is not otherwise handled anywhere in the code
- **THEN** the system logs the error with its stack/detail and the bot continues running or shuts down in a controlled, logged manner

### Requirement: Distinct log signal per inference failure mode
The system SHALL log a distinguishable message for each of: inference provider not configured, inference provider error, and inference timeout.

#### Scenario: Timeout vs. provider error are distinguishable in logs
- **WHEN** one request fails due to timeout and another fails due to a provider error
- **THEN** the log entries for each identify which failure mode occurred

## MODIFIED Requirements

### Requirement: Markdown report generation
The system SHALL provide a command (`npm run stats:report`) that reads the SQLite database and generates a Markdown report file containing: per-model token totals (input, output, total), per-role token breakdown, average latency per model, overall success rate, and tool usage summary. The report file SHALL be written under `data/` (gitignored).

#### Scenario: Report generation with data
- **WHEN** the user runs `npm run stats:report` and the database contains recorded statistics
- **THEN** a Markdown file is generated at `data/stats-report.md` (gitignored) containing tables with per-model token totals, per-role breakdown, latency averages, success rate, and tool usage

#### Scenario: Report generation with empty database
- **WHEN** the user runs `npm run stats:report` and the database is empty or has no recorded statistics
- **THEN** a Markdown file is generated with a "No data" message, and the command exits successfully

## ADDED Requirements

### Requirement: A summary view reports activity, spend and per-task averages
The system SHALL provide a summary view over all recorded activity, reporting: the number of tasks completed, total input, output and cached tokens, the total estimated cost, the average tokens, turns and tool calls per task, and the share of total tokens attributable to each tool, ranked.

#### Scenario: Summary over recorded activity
- **WHEN** the summary view is generated over a database holding several completed tasks
- **THEN** it reports the task count, the token totals, the estimated cost, the per-task averages, and the tools ranked by their share of total tokens

#### Scenario: Summary over an empty database
- **WHEN** the summary view is generated over a database with no recorded activity
- **THEN** it reports that there is no data and completes successfully rather than failing or printing zeroes as though they were measurements

### Requirement: A timeline view walks one task turn by turn
The system SHALL provide a view of a single identified task that lists its turns in order and, for each turn, the tokens the LLM call consumed and the tool calls it produced with their result sizes, so that the cost of one run can be read without querying the tables by hand.

#### Scenario: Timeline of a multi-turn task
- **WHEN** the timeline view is generated for a task that ran several turns with tool calls
- **THEN** it shows each turn in order with that turn's LLM token count, and under it the tool calls made in that turn with their result sizes

#### Scenario: Timeline of an unknown task
- **WHEN** the timeline view is requested for a task identifier that is not in the database
- **THEN** it reports that the task was not found and completes successfully rather than failing

### Requirement: An analysis view identifies where tokens are going
The system SHALL provide an analysis view reporting: the tools ranked by their share of generated tokens, the single most expensive turn with its input token count, the division of input tokens across content categories, and the proportion of input that had already been sent to the model versus what was new.

#### Scenario: Analysis identifies the largest consumers
- **WHEN** the analysis view is generated over a database holding tasks that used several tools across multiple turns
- **THEN** it ranks the tools by token share, names the most expensive turn and its input token count, breaks input down by content category, and reports the repeated and new proportions of input

#### Scenario: Categories account for the reported input
- **WHEN** the analysis view reports the division of input across content categories
- **THEN** the reported shares account for the input tokens they describe, leaving no unattributed remainder

### Requirement: Unavailable figures are reported as unavailable
The system SHALL distinguish a figure that was never measured from a figure measured as zero, and SHALL NOT present the former as an observation. In particular, a cache hit rate SHALL be reported only over calls whose provider actually reported cached tokens, and SHALL be omitted or marked unavailable otherwise.

#### Scenario: Provider reported no cache statistics
- **WHEN** a view covering calls whose provider reported no cached tokens would otherwise show a cache hit rate
- **THEN** the rate is reported as unavailable rather than as zero percent

#### Scenario: Unpriced models in a cost total
- **WHEN** a view reports total estimated cost over activity that included models with no configured price
- **THEN** it indicates that part of the activity was unpriced, so the total is not read as complete spend

#### Scenario: Data recorded before a field existed
- **WHEN** a view covers rows recorded before a field was introduced, whose stored value is a migration default rather than a measurement
- **THEN** those rows are excluded from that field's aggregate or the aggregate is marked as partial, rather than averaging defaults in as observations

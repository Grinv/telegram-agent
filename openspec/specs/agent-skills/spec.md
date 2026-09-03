## Purpose

Gives the agent authored, reusable instructions — how to drive a particular command-line program or HTTP API, and named multi-step routines — as Markdown files that are discovered at startup, advertised to the model as a short index, and retrieved in full only when the model decides one is relevant.

## Requirements

### Requirement: Skills are discovered from a directory at startup
The system SHALL load skills from a configured directory when it starts. Each skill is a Markdown file declaring a name and a one-line description in front matter, followed by the instruction body. The name SHALL be the identifier the model uses to request the skill.

Discovery SHALL happen once at startup, not per message. A deployment with no skills directory, or an empty one, SHALL start normally with no skills available.

#### Scenario: Directory with several skills
- **WHEN** the system starts and the skills directory contains three well-formed skill files
- **THEN** all three skills are available, each with its declared name, description, and body

#### Scenario: Skills directory is absent
- **WHEN** the system starts and the configured skills directory does not exist
- **THEN** the system starts normally, no skills are available, and the absence is reported in the startup logs rather than treated as a failure

#### Scenario: Skills directory is empty
- **WHEN** the system starts and the configured skills directory exists but contains no skill files
- **THEN** the system starts normally and no skills are available

### Requirement: A malformed skill file is skipped, not fatal
The system SHALL ignore a skill file that does not declare both a name and a description, and SHALL report which file was ignored and why. One unusable file SHALL NOT prevent the remaining skills from loading or prevent the system from starting.

Two skills SHALL NOT share a name. If several files declare the same name, the system SHALL keep one, report the collision, and continue.

#### Scenario: One file is missing its description
- **WHEN** the skills directory holds three files and one of them declares a name but no description
- **THEN** the other two skills load, the malformed one is not available, and a message identifying the offending file is logged

#### Scenario: Two skills declare the same name
- **WHEN** two skill files declare the same name
- **THEN** the system starts, exactly one skill with that name is available, and the collision is reported

### Requirement: The model is shown a skill index, not skill bodies
The system SHALL advertise the available skills to the model as a list of names with their one-line descriptions, and SHALL NOT include any skill's instruction body in that list. The list SHALL be presented as part of the instructions the agent sends with every request.

When no skills are available, the system SHALL NOT advertise an empty or placeholder skill list.

#### Scenario: Index lists names and descriptions only
- **WHEN** three skills are loaded and the agent sends a request to the model
- **THEN** the instructions accompanying that request name all three skills with their descriptions, and contain none of their instruction bodies

#### Scenario: No skills available
- **WHEN** no skills are loaded and the agent sends a request to the model
- **THEN** the instructions contain no skill list at all

### Requirement: The model can retrieve one skill's body on demand
The system SHALL provide a tool that takes a skill name and returns that skill's full instruction body, so the model can read a skill after deciding from the index that it is relevant. The tool SHALL serve content loaded at startup and SHALL NOT depend on the skill files being reachable from inside a tool sandbox.

Requesting a name that is not available SHALL produce a failed tool result naming the unknown skill and listing the names that are available, so the model can correct itself rather than retrying blindly.

#### Scenario: Model retrieves a known skill
- **WHEN** the model requests the skill named in the index
- **THEN** the tool result contains that skill's full instruction body

#### Scenario: Model requests an unknown skill
- **WHEN** the model requests a skill name that was not loaded
- **THEN** the tool result is a failure naming the requested skill and listing the available skill names, and the agent's loop continues rather than aborting

#### Scenario: Retrieval does not require the sandbox filesystem
- **WHEN** the model retrieves a skill while the sandbox's writable working directory is empty and its root filesystem is read-only
- **THEN** the skill body is returned successfully

### Requirement: A skill documenting a command-line API client is available
The system SHALL ship a skill whose body documents how to call a remote HTTP API from the command line: which command to run, which endpoint and parameters to use, and how to interpret the output.

#### Scenario: Agent answers using the documented command
- **WHEN** a user asks a question the shipped command-line-API skill covers, and the sandbox is configured to permit outbound network access
- **THEN** the agent retrieves that skill, runs the documented command in the sandbox, and answers from the command's output

### Requirement: A skill describing a multi-step routine is available
The system SHALL ship a skill whose body describes a routine of at least three ordered steps that the agent performs in sequence, ending in a single summary for the user rather than the raw output of each step.

#### Scenario: Agent runs the routine end to end
- **WHEN** a user asks for the routine the shipped skill describes
- **THEN** the agent retrieves that skill, performs its steps in the documented order, and replies with one summary covering all of them

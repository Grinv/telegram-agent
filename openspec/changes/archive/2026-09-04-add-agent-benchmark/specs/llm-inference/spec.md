## ADDED Requirements

### Requirement: Inference requests may specify deterministic sampling
The system SHALL allow an inference request to specify sampling controls that make generation as reproducible as the provider supports, and SHALL pass them to the provider when supplied. A request that supplies none SHALL behave exactly as before, using the provider's defaults.

A connector whose provider does not support such controls SHALL ignore them and still return a result, rather than failing the request.

#### Scenario: Request specifies deterministic sampling
- **WHEN** a request supplies sampling controls for reproducible generation
- **THEN** the provider receives them alongside the request

#### Scenario: Request specifies no sampling controls
- **WHEN** a request supplies no sampling controls
- **THEN** the provider receives the request exactly as it would have before this capability existed

#### Scenario: Connector without sampling support
- **WHEN** a request supplying sampling controls is sent to a connector whose provider does not support them
- **THEN** the connector ignores them and returns a result rather than failing

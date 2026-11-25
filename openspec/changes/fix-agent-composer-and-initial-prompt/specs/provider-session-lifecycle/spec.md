# Spec Delta

## MODIFIED Requirements

### Requirement: Initialization succeeds before a session becomes usable

The system SHALL expose a provider session only after initialization and native session creation succeed, SHALL return initialization errors without inventing a native session identifier, and SHALL report synchronous initial-prompt submission errors instead of acknowledging successful creation.

#### Scenario: Native session creation fails

- **WHEN** a provider rejects or fails its initialization or session-create exchange
- **THEN** the start operation fails with the provider error and no usable native session is emitted

#### Scenario: Initial prompt submission fails

- **WHEN** submitting the initial prompt returns an error during agent creation
- **THEN** the creation request returns the submission error and does not report a usable, successfully created agent

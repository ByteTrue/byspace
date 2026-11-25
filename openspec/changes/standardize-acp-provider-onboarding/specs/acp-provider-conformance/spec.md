# Spec Delta

## Purpose

Give every generic ACP provider the same executable acceptance bar, regardless of which coding agent performed onboarding. Results must distinguish unsupported features from broken advertised behavior.

## ADDED Requirements

### Requirement: Common ACP baseline conformance

The system SHALL provide a `byspace provider check <id>` command that loads the saved provider entry and verifies launch, ACP initialization, session creation, one text prompt, streamed or final assistant output, and terminal turn completion.

#### Scenario: Baseline passes

- **WHEN** a configured generic ACP agent completes initialization, creates a session, answers a text prompt, and ends the turn normally
- **THEN** each baseline check reports PASS and the command exits successfully

#### Scenario: Provider is not generic ACP

- **WHEN** the requested provider is absent, disabled, or does not extend ACP
- **THEN** the command rejects the configuration without claiming protocol conformance

### Requirement: Failures identify the broken stage

The conformance command SHALL report a stable check name and the underlying error for each failure, skip dependent checks after a prerequisite failure, and return a non-zero exit status when any required or advertised-capability check fails.

#### Scenario: Initialization fails

- **WHEN** the agent launches but rejects or fails the ACP initialization request
- **THEN** the initialization check reports FAIL with the protocol error and session-dependent checks do not report PASS

#### Scenario: Prompt fails

- **WHEN** initialization and session creation succeed but the text prompt returns an error or ends without a valid terminal result
- **THEN** the prompt or completion check reports FAIL and the command exits non-zero

### Requirement: Negotiated capabilities select additional checks

After initialization and session creation, the command SHALL derive optional checks from negotiated capabilities and returned catalogs. An advertised feature that fails its check SHALL fail conformance; an unadvertised feature SHALL report SKIP rather than FAIL.

#### Scenario: Image input is advertised

- **WHEN** the agent negotiates image prompt support
- **THEN** the command sends a small image with text and requires a valid completed response

#### Scenario: Native session continuation is advertised

- **WHEN** the agent advertises a supported session load or resume mechanism
- **THEN** the command verifies continuation of the native session it created and completes another text turn

#### Scenario: Model or mode catalogs are returned

- **WHEN** session creation returns selectable model, mode, or thinking options
- **THEN** the command verifies the corresponding selection operation against the created session

#### Scenario: Optional capability is absent

- **WHEN** the agent does not advertise image input, session continuation, or selectable catalogs
- **THEN** each corresponding check reports SKIP and does not prevent an otherwise successful baseline result

### Requirement: Conformance does not create BySpace agents

The conformance command SHALL run an isolated provider session without creating a persistent BySpace agent, workspace, or submitted conversation row.

#### Scenario: Check completes

- **WHEN** a conformance run passes or fails
- **THEN** the BySpace agent and workspace collections are unchanged

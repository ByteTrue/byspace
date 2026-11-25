# Spec Delta

## ADDED Requirements

### Requirement: Image support follows negotiated prompt capabilities

The system SHALL advertise ACP image input support only when negotiated prompt capabilities explicitly include image input.

#### Scenario: Agent omits image prompt capability

- **WHEN** the agent's negotiated prompt capabilities omit image input
- **THEN** the session reports image input as unsupported

#### Scenario: Agent explicitly supports image prompts

- **WHEN** the agent's negotiated prompt capabilities explicitly include image input
- **THEN** the session reports image input as supported

### Requirement: Unsupported image prompts fail before a turn starts

The system SHALL reject an ACP image prompt synchronously when negotiated capabilities do not include image input and SHALL NOT start a turn or forward the image.

#### Scenario: Image is submitted to a text-only agent

- **WHEN** a user submits an image and the negotiated prompt capabilities do not include image input
- **THEN** prompt submission returns an error before a turn starts and the image is not forwarded

# Spec Delta

## MODIFIED Requirements

### Requirement: Attachments respect negotiated model input

The system SHALL use negotiated native model input capabilities to accept or reject image and other attachment kinds before prompt submission and SHALL NOT treat capabilities that have not yet been received as text-only.

#### Scenario: Selected model accepts only text

- **WHEN** a user attempts to include an image
- **THEN** the system reports that the model cannot accept images and does not forward an unsupported prompt

#### Scenario: Initial image prompt arrives before capabilities are known

- **WHEN** an initial prompt includes an image before a new session has received model input capabilities
- **THEN** the system forwards the image for native handling instead of rejecting it locally as unsupported

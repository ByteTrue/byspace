# Spec Delta

## ADDED Requirements

### Requirement: Copy-prompt carries complete recipe

The `acp_onboarding_prompt` response MUST embed the resolved absolute resource path and contain steps that: (1) read the SKILL.md guide at that path; (2) establish the exact ACP argv and authentication from official CLI documentation; (3) use the canonical CLI writer rather than editing JSON directly; (4) reload the daemon; and (5) run `byspace provider check <id>`. The prompt MUST NOT ask the agent to modify BySpace source files for a standard ACP integration.

#### Scenario: Copied prompt configures a generic ACP CLI

- **WHEN** user copies the prompt and follows it with a generic ACP-compatible CLI
- **THEN** the prompt leads the agent through the guide, canonical configuration writer, daemon reload, and common conformance check using the exact documented command

#### Scenario: Works for arbitrary CLIs not shipped by BySpace

- **WHEN** the target CLI has no built-in BySpace adapter
- **THEN** the prompt still works because it depends on the local resource path and generic CLI commands, not on any packaged provider preset

### Requirement: Canonical ACP configuration writer

The system SHALL provide `byspace provider add acp --id <id> --label <label> -- <argv...>`. For the same arguments it SHALL write the same minimal provider entry containing only `extends: "acp"`, the trimmed label, and the exact non-empty argv.

#### Scenario: Configure agy

- **WHEN** the command runs with ID `agy`, label `Antigravity`, and argv `agy acp`
- **THEN** `agents.providers.agy` contains exactly the ACP extension, label, and command `["agy", "acp"]`, with no inferred models, environment, parameters, or provider-specific runtime branch

#### Scenario: Repeat identical input

- **WHEN** the canonical entry already exists and the same command runs again
- **THEN** the command succeeds without changing the entry or adding optional fields

### Requirement: Writer rejects ambiguous or unsafe input

The writer SHALL validate the provider ID, label, and argv; reject built-in IDs; and refuse to replace a different existing provider entry. Validation or persistence failures SHALL leave the existing configuration unchanged and produce a non-zero exit status.

#### Scenario: Existing entry differs

- **WHEN** the requested provider ID already has a different configuration
- **THEN** the command reports the conflict and does not overwrite or merge the entry

#### Scenario: Invalid launch argv

- **WHEN** the argv is empty or contains an empty argument
- **THEN** the command identifies the invalid input and does not write configuration

### Requirement: Writer preserves unrelated configuration

The writer SHALL use the existing atomic configuration persistence behavior, preserve sibling providers and unrelated settings, and report success only after the updated configuration is durable.

#### Scenario: Add beside existing settings

- **WHEN** the configuration already contains other providers and daemon or agent settings
- **THEN** adding an ACP provider changes only the requested provider entry

#### Scenario: Atomic write fails

- **WHEN** the updated configuration cannot be written
- **THEN** the command reports the persistence error and does not print a successful onboarding result

### Requirement: Adapter guidance matches implemented defaults

The embedded onboarding resource SHALL document only supported declarative fields and SHALL state the actual generic ACP filesystem and terminal defaults used by the runtime.

#### Scenario: Agent reads the capability reference

- **WHEN** an onboarding agent follows the ACP configuration reference
- **THEN** it sees filesystem read/write defaulting to false, terminal defaulting to true, and no unsupported ordering field

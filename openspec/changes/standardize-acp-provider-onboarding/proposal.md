# Proposal

## Why

Copy-prompt onboarding currently asks each coding agent to hand-edit ACP provider configuration and judge its own verification. The same CLI can therefore produce different entries and different acceptance standards; stricter prompt wording alone cannot make those outcomes consistent.

## What Changes

- Keep **Settings → Agents → Add provider → Copy prompt** as the documentation and authentication discovery entry point. Do not restore a preset catalog or add a provider-specific UI form.
- Add a canonical CLI writer for generic ACP providers. Given the same provider ID, label, and launch argv, it writes the same minimal `extends: "acp"` entry, validates inputs, preserves unrelated configuration, and handles existing entries explicitly.
- Add a reusable CLI conformance check that runs the same mandatory launch/initialize/session/text-prompt/completion/error-reporting checks for every generic ACP provider, followed by checks selected from negotiated capabilities.
- Update the copied prompt and embedded adapter guide to require the canonical writer and conformance check instead of direct JSON editing and self-selected verification.
- Correct onboarding guidance that disagrees with implemented ACP capability defaults or advertises unsupported fields. Do not change ACP runtime negotiation or add special-case adapter code for agy or another CLI.

## Capabilities

### New Capabilities

- `acp-provider-conformance`: Common, repeatable acceptance checks for an independently configured generic ACP provider, including mandatory protocol behavior and capability-conditional coverage.

### Modified Capabilities

- `acp-provider-onboarding`: The existing copy-prompt workflow remains, but configuration writing and acceptance move to canonical BySpace CLI commands rather than agent-authored JSON and ad hoc verification.

## Impact

- **CLI/configuration:** provider command handling and existing atomic daemon-config persistence/validation.
- **ACP verification:** reusable launch/session/conformance helpers built on the generic ACP provider implementation.
- **Onboarding resources/docs:** embedded copy-prompt resource, adapter guide/reference, and custom-provider documentation.
- **UI/protocol/dependencies:** no provider catalog, settings form, WebSocket schema, persistence migration, or new dependency is planned.
- **Example target:** agy uses the same generic path with launch argv `["agy", "acp"]`; it receives no preset or provider-specific runtime branch.

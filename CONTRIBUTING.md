# Contributing to BySpace

Thank you for taking the time to contribute to BySpace.

## Philosophy

BySpace is an opinionated product built around a hosted browser app, a local daemon and CLI, an encrypted relay, and multiple agent providers. Read [the product direction](docs/product.md) before proposing product or design changes.

The project is maintained by one person, so product fit, a focused scope, composability, and a quality bar that can be maintained over time all matter. The `docs/` directory is the source of truth for system and process decisions; a pull request must follow those documents rather than replacing them with a second policy in prose or code comments.

## Issues and feature requests

Open a [GitHub issue](https://github.com/ByteTrue/byspace/issues) for a bug or feature request. Explain the workflow and problem, not only the requested implementation:

- What are you trying to do?
- What happens today?
- Where does BySpace get in the way?
- What would the flow look like if it worked?

For a bug, include reproduction steps, the BySpace version, browser and host OS, agent provider when relevant, and raw evidence such as logs, command output, screenshots, or video. Redact secrets. If an agent helped investigate, include its raw evidence and reproduction steps rather than relying on its diagnosis.

## Pull requests

Anyone can open a pull request, but there is no guarantee that it will be merged. Link the issue first and keep the change focused.

Open the pull request as a draft if the work is not ready, if you want to run checks, or if you want early feedback on direction. Mark it ready only when you want maintainer review.

✅ Likely to be accepted

- Fits the product direction and the linked issue
- Makes one focused change with explicit goals and non-goals
- Explains the problem in terms of a real user flow
- Addresses review feedback
- Includes QA evidence and focused automated tests
- Includes screenshots or video for UI changes at every affected browser viewport
- States what was tested and what was not
- Keeps maintainer edits enabled

⛔️ Will be rejected

- Bundles unrelated changes
- Fails required checks
- Ignores review feedback
- Introduces an unapproved product or design direction
- Omits the linked issue, QA evidence, or applicable tests
- Is clearly fully AI-generated and not understood, reviewed, and tested by the contributor

A pull request may be narrowed, refactored, redesigned, deferred, or closed without a detailed review. Prior alignment improves the chance of acceptance but does not replace evidence.

## QA evidence

QA evidence is required. Include concrete evidence such as:

- Shell commands with their relevant output
- Focused tests added or updated, with results
- Reproduction before the fix and confirmation after it
- Before-and-after screenshots for static UI
- Video for interactions, animation, or timing
- Relevant logs, requests, and responses

Behavior changes and bug fixes need tests that exercise the real behavior. UI changes need evidence at every affected browser viewport. Follow [the testing guide](docs/testing.md) for test shape and local command limits, and [the development guide](docs/development.md) for build and runtime workflows.

## BySpace-specific change policies

Some changes have stricter source-of-truth processes:

- **Upstream synchronization:** follow [the upstream sync process](docs/upstream-sync.md). The pull request must carry its frozen source references, dispositions, focused and full validation, fidelity review, and exact-SHA CI evidence.
- **Release preparation:** follow [the release playbook](docs/release.md) and [release engineering controls](docs/release-engineering.md). Include exact-SHA CI evidence, the target channel evidence, and proof that the other channel remained unchanged.

Do not duplicate or weaken those policies in a pull request description. Link to the authoritative documents and provide the evidence they require.

## AI assistance

Using AI to help write code or a pull request description is fine, but you must:

- Ensure the agents read the relevant docs
- Understand and review the submitted change
- Run the checks and verify the evidence yourself
- Never present generated verification claims as tests you actually ran

## Becoming a maintainer

There is no formal process. Consistently help reproduce bugs, review evidence, answer questions, and implement maintainer-aligned work to build the context required for broader responsibility.

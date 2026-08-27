# Project readiness

Use this model across languages and project types. It describes developer behavior, not framework recipes.

## The evidence rule

A recommendation is justified only when the repository shows both:

1. evidence of a command, dependency, local input, runtime, convention, or shared resource; and
2. a clean-worktree failure, repeated manual step, discoverability gap, or parallelism risk.

Examples of evidence include manifests, lockfiles, ignore rules, example config, scripts, docs, CI commands, compose files, runtime configuration, and existing history/conventions. A language or directory name alone is weak evidence.

## Assessment areas

### Deterministic dependency restoration

Ask whether a clean checkout can restore the dependencies intended by the repository.

Look for:

- dependency manifests and lockfiles
- declared package/tool versions
- ignored dependency directories or local caches
- documented install commands
- workspace or monorepo relationships

Recommend the repository's own deterministic install mechanism when a lock or equivalent source of truth exists. If the sources disagree, identify the ambiguity instead of choosing silently. If no reproducibility mechanism exists, explain that gap; do not invent or regenerate one without approval.

Do not add a prefetch/install setup command merely to validate a lockfile when the repository has no external dependencies and its documented first command already handles the empty graph. A no-op bootstrap is not readiness work.

Do not churn an existing harmless setup command solely because the current dependency graph makes it a no-op. Preserve it unless it causes observable friction or risk, or the user explicitly asks for cleanup.

Do not recommend adding or changing a language/runtime version policy merely because the current machine uses a newer toolchain. Require repository evidence such as an existing version file, documented compatibility target, CI constraint, or a reproducible clean-worktree failure. Toolchain governance is not readiness work by default.

### Local-only inputs

Look for ignored files that development requires:

- environment/config files
- certificates and credentials
- local databases or fixtures
- generated assets
- tool state

Prefer generation from checked-in examples over copying machine-local state. Creating an ignored environment/config file from a checked-in example still requires approval of that exact item; broad permission to "do anything helpful" is not enough. If copying from the source checkout is the only practical path, ask first and name what category of data would move. Do not inspect or copy secrets by default.

### Bootstrap and generation

Find steps required after dependency restoration and before ordinary commands work:

- code generation
- workspace package builds
- schema generation
- local database setup/migration/seed
- repository-specific state seeding

Distinguish a required bootstrap step from a task that can run lazily. Setup should contain only what every new worktree needs. If a step is expensive but not universal, expose it as an on-demand script instead.

### Frequent one-off commands

Good BySpace script candidates are commands a person or Agent repeatedly needs and benefits from finding without re-reading docs:

- targeted build or code generation
- type or static checks
- lint/format checks
- focused tests
- migrations or safe diagnostics

Do not mirror every task-runner entry. Prefer a few project-level commands that already encode the correct workspace scope.

### Long-running services

Treat a command as a service when evidence shows it remains running, usually listens on a port, and benefits from supervision or a stable URL.

Check:

- how host and port are configured
- whether the process can accept a dynamic port
- whether it depends on peer services
- whether multiple instances can coexist
- whether startup requires a wrapper or prerequisite build

A service entry is incomplete if its real command still hard-codes a colliding port. Prefer adapting the existing command or adding one minimal project-native wrapper.

### Parallel worktree isolation

Look for shared mutable names or fixed locations:

- ports
- database/schema names
- container and compose project names
- volumes
- sockets and pid files
- caches and generated output outside the worktree
- daemon homes or runtime state

State the concrete collision or cleanup risk. Do not add isolation machinery where the project has no evidence of shared mutable resources.

### Resource ownership and teardown

Teardown is warranted only for resources the worktree created and can identify precisely. A safe proposal explains:

- what owns the resource
- how the current worktree identifies it
- why deleting it cannot affect another worktree or the source checkout

If any answer is uncertain, omit teardown and put the decision in **Needs your decision**.

### Metadata conventions

Look for explicit or strongly established conventions in contributing docs, commit tooling, PR templates, branch history, and CI checks. Recommend metadata instructions only when they preserve those conventions.

Do not infer Conventional Commits, branch prefixes, or PR templates from ecosystem popularity.

### Automatic terminals

Automatic terminals are useful only when every new worktree benefits from an immediately running interactive or observation command. Prefer on-demand scripts/services for optional work. Do not auto-run expensive commands as terminals merely for convenience.

## Recommendation levels

### Needs attention

Use when the evidence predicts one of:

- a clean worktree cannot perform ordinary development
- setup is nondeterministic despite an available repository source of truth
- parallel worktrees collide
- cleanup may delete shared data
- an existing BySpace service configuration cannot actually bind or discover peers correctly

### Worth adding

Use for evidence-backed leverage without claiming failure:

- a commonly repeated command is hard to discover
- a long-running process would benefit from supervision and a stable URL
- a stable project wrapper would replace repeated manual command composition

### Needs your decision

Use when repository evidence cannot decide a real preference or risk:

- copy or generate local environment data
- choose among multiple valid primary services
- create, seed, migrate, or remove data
- adopt a convention the project does not already have
- trade a costly universal setup step against on-demand execution

### Not recommended

Use only when the user is likely to expect an item but omitting it is important—for example, no teardown because resource ownership is not provable, or no service because the repository is a library with no long-running process.

## Minimality test

Before proposing each change, ask:

1. Does an existing command already solve it?
2. Can `byspace.json` reference that command directly?
3. If not, is one small project-native script enough?
4. Is the recommendation still useful if the project never grows?

If the answer becomes speculative, omit it.

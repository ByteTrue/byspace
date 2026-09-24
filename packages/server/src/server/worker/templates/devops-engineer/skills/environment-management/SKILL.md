---
name: environment-management
description: Define and maintain development, staging, production, preview, and test environment strategy, configuration boundaries, and promotion rules.
version: 1.0.0
---

# Environment Management

Use when setting up or rationalizing dev, test, staging, preview, or production environments.

## Workflow

1. Identify environments, owners, access model, runtime, data policy, and promotion path.
2. Map configuration, secrets, dependencies, and external integrations per environment.
3. Define drift controls, parity rules, reset process, and test-data boundaries.
4. Add validation checks and deployment gates.
5. Produce environment matrix and governance rules.

## Output

Return an environment matrix with purpose, config, secrets boundary, access, promotion rules, and validation.

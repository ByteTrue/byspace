---
name: secret-config-governance
description: Review and design secrets, environment variables, configuration ownership, rotation boundaries, and safe config delivery practices.
version: 1.0.0
---

# Secret and Config Governance

Use when handling secrets, environment variables, config files, or deployment-time configuration.

## Workflow

1. Inventory config and secret categories without exposing secret values.
2. Identify storage, access, rotation, injection, and audit mechanisms.
3. Separate public config, sensitive config, and runtime secrets.
4. Define ownership, least-privilege access, rotation process, and leak response.
5. Provide safe migration or remediation plan.

## Output

Return governance plan with config taxonomy, secret boundaries, owners, rotation, audit, and remediation.

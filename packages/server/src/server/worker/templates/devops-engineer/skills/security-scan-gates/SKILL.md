---
name: security-scan-gates
description: Add dependency, secret, container, IaC, and static-analysis security scan gates to CI/CD workflows with severity policy.
version: 1.0.0
---

# Security Scan Gates

Use when CI/CD needs security checks or when a pipeline's security posture is unclear.

## Workflow

1. Identify technology stack, package managers, container usage, IaC, and deployment target.
2. Select scan types: dependency, secrets, SAST, container, IaC, license, or SBOM.
3. Define severity thresholds, blocking policy, exceptions, and owner workflow.
4. Place gates in the pipeline with artifacts and reporting.
5. Add remediation and bypass rules that require approval.

## Output

Return scan-gate plan with tools, stages, thresholds, artifacts, owners, and exception policy.

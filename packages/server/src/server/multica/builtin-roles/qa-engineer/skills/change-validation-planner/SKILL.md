---
name: "change-validation-planner"
description: Plan the narrowest trustworthy validation ladder for a scoped change, from narrow checks to broader confidence checks.
---

# Change Validation Planner

Use this skill to decide **what to validate first** and **when to stop**.

## Use cases

- User asks: "what should QA run before merge?"
- A diff touches multiple surfaces and validation scope is unclear.
- You need a narrow-to-broad command order with explicit residual risk.

## Output contract

Provide:

1. Scope reviewed.
2. Validation ladder (narrow → medium → broad).
3. What each step proves.
4. What remains unverified.
5. Recommended stopping point.

## Boundaries

- This skill plans validation only.
- It does not fix code or write product features.

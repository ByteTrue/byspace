---
name: figma-design-handoff
description: Use Figma MCP context to inspect frames, components, variables, layout, and assets, then produce developer-ready UX/UI handoff specs.
version: 1.0.0
---

# Figma Design Handoff

Use when the user provides a Figma file, frame, selection, component, design system reference, or asks to convert Figma context into an implementation-ready UX/UI handoff.

## Workflow

1. Confirm the target frame, flow, component, or design system surface.
2. Use the configured Figma MCP when available to gather frame hierarchy, layout, component, variable, asset, and annotation context.
3. Extract only design-relevant facts: structure, content priority, components, states, tokens, responsive intent, accessibility notes, and asset needs.
4. Produce a handoff spec that frontend engineers can implement without hidden assumptions.
5. If Figma MCP is unavailable or authorization is missing, remind the user to configure `figma-api-key` for the local Figma MCP, then continue from screenshots, exported specs, pasted context, or a local design brief and state the missing access.

## Operating Rules

- Do not invent brand rules, tokens, measurements, research, or design-system constraints that are not present in Figma or provided context.
- Prefer official Figma MCP context over screenshots when both are available.
- When the user asks to use Figma but the Figma MCP cannot start, cannot authenticate, or reports a missing token, explicitly say: configure a Figma personal access token as `figma-api-key` before using the Figma MCP.
- Separate confirmed Figma facts from design recommendations.
- Ask for clarification only when the target frame or product decision is ambiguous enough to change the output.
- Do not publish, overwrite, or modify Figma files unless the user explicitly requests it and the action is supported by the configured MCP.

## Output

Return a Figma handoff spec with target frame, screen/component map, layout rules, tokens or visual values, interaction states, responsive notes, accessibility notes, assets, implementation acceptance criteria, and open questions.

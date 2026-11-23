---
title: Supported providers
description: Native coding-agent providers and generic ACP onboarding.
nav: Supported providers
order: 21
category: Providers
---

# Supported providers

For the concept and how BySpace manages providers, see [Providers](/docs/providers). To add or configure your own, see [Custom providers](/docs/custom-providers).

## Native support

These work out of the box once the underlying CLI is installed and authenticated.

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Anthropic's coding agent with MCP support, streaming, and deep reasoning.
- [Codex](/docs/codex). OpenAI's workspace agent with sandbox controls and optional network access.
- [OpenCode](https://opencode.ai/). Open-source coding assistant with multi-provider model support.
- [Pi](https://pi.dev). Minimal terminal-based coding agent with multi-provider LLM support.

## ACP-compatible agents

Any agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com) over stdio can be added, including Cursor, Gemini CLI, GitHub Copilot, Hermes, Kimi, Kiro, and Qwen Code.

Open **Settings → Agents → Add provider → Copy onboarding prompt**, then paste the prompt into an agent on the same machine as the BySpace daemon. The prompt points to BySpace's ACP configuration template by absolute path. The agent reads it on demand and writes the provider configuration; BySpace does not install it as a skill.

You can also write an `extends: "acp"` provider entry yourself. See [Custom providers](/docs/custom-providers).

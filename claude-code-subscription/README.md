# Claude Code (Subscription) — Buzz Plugin for Windows 11

This Buzz folder plugin registers **Claude Code (Subscription)** as a first-class Agent Builder harness on Windows 11. It drives Anthropic's official `claude` CLI already signed in with your Claude Pro/Max subscription.

## Prerequisites

- **OS & App:** Windows 11 and the [Buzz desktop app](https://github.com/block/buzz-app)
- **Node.js:** Node.js `v20+` (verified on `v24.x`) on `PATH` for local verification scripts
- **Official CLI:** Anthropic's official Claude Code CLI (`claude.exe` or `claude.cmd`) on `PATH`
- **Subscription Sign-In:** Run `claude` once in PowerShell or Windows Terminal and select **Claude account with subscription**

```powershell
claude --version
```

## Security & Architecture

- **Zero credential reads:** Never reads, copies, logs, or exports Claude's stored OAuth credentials.
- **API-key isolation:** Checks only whether `ANTHROPIC_API_KEY` exists in the environment (never its value) and passes `ANTHROPIC_API_KEY: null` to every child process so an environment variable cannot override subscription login.
- **UTF-8 stdin JSON envelope:** Sends `{ args, prompt, mcpConfig }` over UTF-8 stdin to a declared PowerShell wrapper. This avoids Windows `.cmd` argument-quoting corruption and the 32 KiB command-line ceiling.
- **Temp UTF-8 no-BOM MCP config & sentinel swap:** Writes `mcpConfig` as UTF-8 without BOM to a temporary file, swaps the `__BUZZ_MCP_CONFIG__` sentinel in the argv array, passes `--strict-mcp-config --allowedTools mcp__buzz`, and deletes the temp file in `finally`.
- **Completion-gated Buzz send detection:** Tracks `tool_use` IDs for Buzz `send` / `reply_in_subthread` and marks the turn as sent only when the matching `tool_result` succeeds (`is_error !== true`), ensuring rejected tool calls fall back to publishing the final text reply.

## Models Exposed

- `sonnet` — Sonnet (latest)
- `opus` — Opus (latest)
- `fable` — Fable (latest)
- `haiku` — Haiku (latest)
- `claude-fable-5-2` — Claude Fable 5.2
- `claude-opus-5-5` — Claude Opus 5.5
- `claude-sonnet-5-5` — Claude Sonnet 5.5
- `claude-haiku-5-5` — Claude Haiku 5.5

## Local Verification

Run from `%USERPROFILE%\buzz-subscription-harnesses\claude-code-subscription`:

```powershell
node --check plugin.js
node verify.mjs
node verify-large-prompt.mjs
```

- `verify.mjs` proves hostile prompt strings (`"quotes"; $() 🐝`) stay inert data and never execute in PowerShell.
- `verify-large-prompt.mjs` proves a >100 KB Unicode prompt and temp MCP config reach `claude.cmd` intact.

## Install in Buzz

1. Open **Settings > Plugins > Manage plugins**.
2. Click **Add**.
3. Under **Add from folder**, click **Browse** (always use **Browse**, not drag-and-drop, so Buzz keeps the source path reloadable).
4. Select `%USERPROFILE%\buzz-subscription-harnesses\claude-code-subscription`.
5. Review the declared host access (two fixed PowerShell processes `claude` and `diagnose`, local file read, and loopback MCP) and click **Install plugin**.
6. Open **Settings > Claude Code (Subscription)** and click **Test Claude subscription** to confirm `apiKeySource=none`.

## Build From Scratch (One-Shot)

To have any capable Buzz coding agent build, install, and verify this plugin from scratch on Windows 11, paste [`ONE-SHOT-PROMPT.md`](./ONE-SHOT-PROMPT.md) into Buzz.

## Risk Note

These drive the official signed-in CLIs; they never read or copy stored tokens. Each provider's terms govern subscription use, and heavy automated use may risk your account. Use at your own discretion.

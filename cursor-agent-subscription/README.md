# Cursor Agent (Subscription) — Buzz Plugin for Windows 11

This Buzz folder plugin registers **Cursor Agent (Subscription)** as a first-class Agent Builder harness on Windows 11. It drives the official `cursor-agent` CLI using the Cursor subscription account already signed in on your PC.

> **Multi-Model Coverage via Cursor:** A single **Cursor Agent (Subscription)** installation serves **Composer** (`composer-2.5`, `composer-2.5-fast`), **Grok** (`grok-4.7-*`, `cursor-grok-4.6-*`, `cursor-grok-4.5-*`), and **Gemini Argon** (`gemini-4-argon-high`) models (along with GPT and Claude thinking models) inside Buzz—allowing you to run dedicated `@Cursor` (Composer 2.5), `@Grok` (Grok 4.7), and `@Cursor-Argon` (Gemini 4 Argon) agents side by side on one Cursor login.

## Prerequisites

- **OS & App:** Windows 11 and the [Buzz desktop app](https://github.com/block/buzz-app)
- **Node.js:** Node.js `v20+` (verified on `v24.x`) on `PATH` for local verification scripts
- **Official CLI:** Cursor Agent CLI (`cursor-agent.cmd` or `agent.cmd`) on `PATH`
- **Subscription Sign-In:** Run `cursor-agent login` in PowerShell and verify with `cursor-agent status` (`Logged in as ...`)

```powershell
cursor-agent --version
cursor-agent login
cursor-agent status
```

## Security & Architecture

- **Zero credential reads:** Never reads, copies, logs, or exports Cursor's stored authentication tokens.
- **API-key isolation & login enforcement:** Checks only whether `CURSOR_API_KEY` exists in the environment (never its value), passes `CURSOR_API_KEY: null` to every child process, and verifies `apiKeySource === "login"` on the `system/init` stream event.
- **UTF-8 stdin JSON envelope:** Sends `{ args, prompt, mcpConfig, wrapperKey }` over UTF-8 stdin to the declared PowerShell launcher, which pipes `$p.prompt` over stdin into `cursor-agent.cmd -p --output-format stream-json`.
- **Temp `.cursor-plugin` + sentinel swap (`__BUZZ_PLUGIN_DIR__`):** Writes `.cursor-plugin\plugin.json` and `mcp.json` into `%TEMP%\buzz-cursor-<wrapperKey>`, swaps `__BUZZ_PLUGIN_DIR__` in `args` with that directory path, and passes `--trust --approve-mcps --plugin-dir <dir>`.
- **Windows `MAX_PATH` protection:** Generates a compact random `wrapperKey` (`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`) so `%TEMP%\buzz-cursor-<wrapperKey>` never overflows Windows PowerShell 5.1's 260-character path limit.
- **Dynamic model discovery + 5-minute diagnostic cache:** Queries `cursor-agent models` on load so newly released models appear automatically (falling back to the built-in catalog if offline), and caches `cursor-agent status` diagnostics for 5 minutes so turns start immediately without redundant CLI status checks.
- **Completion-gated Buzz send tracking:** Marks a turn as sent only when a Buzz `send` / `reply_in_subthread` tool call reaches `subtype === "completed"` without error/rejection (`!toolCallFailed(event.tool_call)`), falling back to `agents.harness.reply` otherwise.
- **Dedicated `cleanup` process:** Runs a declared `cleanup` process in `finally` so temporary MCP directories are removed even if a turn is cancelled mid-flight.

## Models Served via Cursor

- **Auto:** `auto`
- **Composer:** `composer-2.5`, `composer-2.5-fast`
- **Grok:** `grok-4.7-low`, `grok-4.7-low-fast`, `grok-4.7-medium`, `grok-4.7-medium-fast`, `grok-4.7-high`, `grok-4.7-high-fast`, `grok-4.7-xhigh`, `grok-4.7-xhigh-fast`, plus `cursor-grok-4.6-*` and `cursor-grok-4.5-*`
- **Gemini Argon:** `gemini-4-argon-high` (Gemini 4 Argon High)
- **Additional Cursor Models:** `gpt-5.3-codex`, `gpt-5.6-sol-high`, `claude-opus-5-5-high`, `claude-opus-5-thinking-high`, `claude-fable-5-thinking-high`, `claude-sonnet-5-thinking-high`

## Local Verification

Run from `%USERPROFILE%\buzz-subscription-harnesses\cursor-agent-subscription`:

```powershell
node --check plugin.js
node verify.mjs
node verify-large-prompt.mjs
```

- `verify.mjs` proves hostile prompt strings (`"quotes"; $() 🐝`) stay inert data and verifies the `cleanup` process removes temporary files in `%TEMP%`.
- `verify-large-prompt.mjs` proves a >100 KB Unicode prompt and `__BUZZ_PLUGIN_DIR__` sentinel replacement reach `cursor-agent.cmd` intact over stdin.

## Install in Buzz

1. Open **Settings > Plugins > Manage plugins**.
2. Click **Add**.
3. Under **Add from folder**, click **Browse** (always use **Browse**, not drag-and-drop, so Buzz keeps the source path reloadable).
4. Select `%USERPROFILE%\buzz-subscription-harnesses\cursor-agent-subscription`.
5. Review the declared host access (three fixed PowerShell processes `cursor`, `diagnose`, and `cleanup`, local file read, and loopback MCP) and click **Install plugin**.
6. Open **Settings > Cursor Agent (Subscription)** and click **Test Cursor subscription** to confirm `CURSOR_SUBSCRIPTION_OK`.

## Build From Scratch (One-Shot)

To have any capable Buzz coding agent build, install, and verify this plugin from scratch on Windows 11, paste [`ONE-SHOT-PROMPT.md`](./ONE-SHOT-PROMPT.md) into Buzz.

## Risk Note

These drive the official signed-in CLIs; they never read or copy stored tokens. Each provider's terms govern subscription use, and heavy automated use may risk your account. Use at your own discretion.

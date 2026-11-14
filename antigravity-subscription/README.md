# Google Antigravity (Subscription) — Buzz Plugin for Windows 11

This Buzz folder plugin registers **Google Antigravity (Subscription)** as a first-class Agent Builder harness on Windows 11. It drives the official `agy` CLI installed with Google Antigravity using your already signed-in Google account.

> **Known Gotcha — Why Antigravity (`agy`) Instead of `gemini` CLI:**
> The official standalone Gemini CLI (`gemini`) rejects free-tier and standard Google accounts during OAuth/headless execution with `UNSUPPORTED_CLIENT`. Google Antigravity's official CLI (`agy`) supports signed-in Google accounts natively over headless `--input-format stream-json --output-format stream-json` without requiring a paid Vertex/AI Studio API key.

## Prerequisites

- **OS & App:** Windows 11 and the [Buzz desktop app](https://github.com/block/buzz-app)
- **Node.js:** Node.js `v20+` (verified on `v24.x`) on `PATH` for local verification scripts
- **Official CLI:** Google Antigravity installed and signed in, with its CLI registered on `PATH` (`agy.cmd` or `agy.exe`) via `agy install`

```powershell
agy --version
```

## Security & Architecture

- **Zero credential reads:** Never reads, copies, logs, or exports stored Google or Antigravity credentials.
- **API-key isolation:** Checks only whether `GEMINI_API_KEY` or `GOOGLE_API_KEY` exists in the environment (never their values) and passes `GEMINI_API_KEY: null` and `GOOGLE_API_KEY: null` to every child process.
- **UTF-8 stdin JSON envelope + NDJSON stream input:** Sends `{ args, input, mcpConfig, wrapperKey }` over UTF-8 stdin to the declared PowerShell launcher, which pipes the NDJSON user turn (`{"event":"user","message":{"content":"..."}}`) into `agy --input-format stream-json --output-format stream-json`.
- **Ephemeral UTF-8 no-BOM MCP plugin wrapper:** Creates an isolated temporary workspace plugin under `%TEMP%\buzz-antigravity-<key>\.agents\plugins\buzz\mcp_config.json` pointing `serverUrl` at Buzz's per-turn loopback MCP server, attaches the user's real working folder via `--add-dir`, and deletes the temporary plugin directory in `finally`.
- **Wrapped MCP send detection:** Detects both direct `send` / `reply_in_subthread` tool calls and Antigravity's `call_mcp_tool` wrapper (`params.ToolName` / `params.tool`) so Buzz never posts a duplicate fallback message.

## Models Exposed

- `default` — CLI default
- `gemini-3.8-flash-high` — Gemini 3.8 Flash (High)
- `gemini-3.8-flash-medium` — Gemini 3.8 Flash (Medium)
- `gemini-3.8-flash-low` — Gemini 3.8 Flash (Low)
- `claude-sonnet-4-6` — Claude Sonnet 4.6 (Thinking)
- `claude-opus-4-6-thinking` — Claude Opus 4.6 (Thinking)
- `gpt-oss-120b-medium` — GPT-OSS 120B (Medium)

## Local Verification

Run from `%USERPROFILE%\buzz-subscription-harnesses\antigravity-subscription`:

```powershell
node --check plugin.js
node verify.mjs
node verify-large-prompt.mjs
```

- `verify.mjs` proves hostile prompt strings (`"quotes"; $() 🐝`) stay inert data inside the JSON/NDJSON stdin envelope and never execute in PowerShell.
- `verify-large-prompt.mjs` proves a >100 KB Unicode prompt and ephemeral `.agents/plugins/buzz/mcp_config.json` reach `agy.cmd` intact.

## Install in Buzz

1. Open **Settings > Plugins > Manage plugins**.
2. Click **Add**.
3. Under **Add from folder**, click **Browse** (always use **Browse**, not drag-and-drop, so Buzz keeps the source path reloadable).
4. Select `%USERPROFILE%\buzz-subscription-harnesses\antigravity-subscription`.
5. Review the declared host access (two fixed PowerShell processes `antigravity` and `diagnose`, local file read, and loopback MCP) and click **Install plugin**.
6. Open **Settings > Google Antigravity (Subscription)** and click **Test Antigravity subscription** to confirm headless stream-json execution.

## Build From Scratch (One-Shot)

To have any capable Buzz coding agent build, install, and verify this plugin from scratch on Windows 11, paste [`ONE-SHOT-PROMPT.md`](./ONE-SHOT-PROMPT.md) into Buzz.

## Risk Note

These drive the official signed-in CLIs; they never read or copy stored tokens. Each provider's terms govern subscription use, and heavy automated use may risk your account. Use at your own discretion.

# One-Shot Prompt: Build, Install & Verify Google Antigravity (Subscription) for Buzz on Windows 11

## Prerequisites Before Pasting

1. **Windows 11** with the **Buzz desktop app** installed.
2. **Node.js 20+** (`node --version`, verified on Node `v24.x`).
3. **Official Google Antigravity CLI (`agy`)** installed and signed in with your Google account:
   ```powershell
   agy install
   agy --version
   ```
   > **Known Gotcha:** Do **not** use the standalone Gemini CLI (`gemini`). Free-tier and standard Google accounts are rejected by the official Gemini CLI with `UNSUPPORTED_CLIENT`, which is why the official Antigravity CLI (`agy`) is used here.
4. **How installation works in Buzz:** Approve or install via **Settings > Plugins > Manage plugins > Add > Browse** (choose `%USERPROFILE%\buzz-subscription-harnesses\antigravity-subscription`).

---

## Copy and Paste Everything Below into a Buzz Agent

```markdown
Build, install, test, and verify a production-ready Buzz plugin for Windows 11 named **Google Antigravity (Subscription)** in `%USERPROFILE%\buzz-subscription-harnesses\antigravity-subscription`. It must add an Agent Builder harness that drives the user's official, locally installed Google Antigravity CLI (`agy`) using their already signed-in Google account.

> **Important Context / Known Gotcha:** The standalone Gemini CLI (`gemini`) rejects free-tier Google accounts with `UNSUPPORTED_CLIENT`. Use the official Google Antigravity CLI (`agy.cmd` / `agy.exe`) instead, which supports headless `--input-format stream-json --output-format stream-json` execution with the signed-in desktop account.

Do not stop after generating files. Carry the work through local validation, installation/reload, agent creation, and a real end-to-end conversation test. Ask the owner only for actions Buzz requires a human to approve, such as first installation or review of changed host permissions/process declarations.

## 1. Non-negotiable authentication and security rules

1. **Do not use Google or Gemini API keys.**
2. **Do not request, read, copy, log, export, or reuse stored Google or Antigravity OAuth tokens or credential files.**
3. Drive only the official `agy` CLI (`agy.cmd` or `agy.exe`) already installed and signed in by the user.
4. Detect only whether `GEMINI_API_KEY` or `GOOGLE_API_KEY` exists; never read or display their values.
5. Strip both `GEMINI_API_KEY` and `GOOGLE_API_KEY` from every child process by passing `GEMINI_API_KEY: null` and `GOOGLE_API_KEY: null` in the spawn environment. Warn the owner once if either variable is present.
6. Never print MCP Authorization headers, OAuth data, or other secrets in diagnostics or errors. Redact them with a `redact()` helper before surfacing any error.
7. Use only a loopback Buzz MCP server created for the current turn, and close it in `finally` when the turn exits, fails, or is cancelled.

## 2. Read the installed Buzz contract first

Before writing code, read Buzz's bundled `plugin_authoring_guide` tool and confirm the exact signatures for:

- plugin manifest API version `1`;
- `agents.register` (`models`, `syncedSettings`, `CreateConfiguration`, `tabs`, `resumes`, `timeoutMs`);
- `agents.harness.conversation`, `systemPrompt`, `turnPrompt`, `tools`, and `reply`;
- `agents.storage` read/set semantics;
- `host.spawn`, `host.serveMcp`, and `host.readFile`;
- `ctx.settingsCards.register` and `ctx.react`.

The plugin folder must contain:

- `manifest.json`
- one self-contained ES module named `plugin.js`
- `README.md`
- `verify.mjs` and `verify-large-prompt.mjs`

## 3. Plugin identity and discovery

- Manifest ID: `community.gemini-cli-subscription` (or `community.antigravity-subscription` on a clean install)
- Name: `Google Antigravity (Subscription)`
- API version: `1`
- Description: `Run the official signed-in Google Antigravity CLI as a Buzz agent on Windows.`
- Discovery category: `agents`, tags: `["Windows", "Google", "Antigravity", "subscription", "coding-agents"]`
- Host access: `files: true`, `mcp: true`, and two fixed PowerShell processes (`antigravity` and `diagnose`).

## 4. Windows launcher: stdin JSON envelope + ephemeral UTF-8 no-BOM MCP plugin directory

Antigravity discovers workspace MCP servers from `.agents/plugins/<name>/mcp_config.json` (using `serverUrl` + `headers`) alongside `.agents/plugins/<name>/plugin.json`, and accepts prompts over stdin as NDJSON (`{"event":"user","message":{"content":"..."}}`) when invoked with `--input-format stream-json --output-format stream-json --print=`.

Use this exact transport pattern so you never touch the user's global `~/.gemini` config or hit Windows `.cmd` quoting limits:

1. Buzz sends one UTF-8 JSON envelope over stdin to the declared `antigravity` PowerShell process:
   - `args`: the `agy` argument array (including `--add-dir <workspace>` so `agy` has full access to the configured working folder while running inside the temp wrapper directory)
   - `input`: the NDJSON line `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`
   - `mcpConfig`: serialized JSON `{ mcpServers: { buzz: { serverUrl: mcp.url, headers } } }`
   - `wrapperKey`: sanitized per-conversation key
2. PowerShell creates `%TEMP%\buzz-antigravity-<wrapperKey>\.agents\plugins\buzz`, writes `plugin.json` and `mcp_config.json` as UTF-8 without BOM, `Push-Location`s into the wrapper root, pipes `$p.input` into `& $c.Source @($p.args)`, and removes the `.agents/plugins/buzz` directory in `finally`.

Use this exact `antigravity` process command in `manifest.json`:

```powershell
$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Text.UTF8Encoding]::new($false);$c=Get-Command agy.cmd,agy.exe -EA 0|Select-Object -First 1;if(!$c){exit 127};$p=([Console]::In.ReadToEnd()|ConvertFrom-Json);$r=Join-Path $env:TEMP ('buzz-antigravity-'+([string]$p.wrapperKey-replace'[^a-zA-Z0-9._-]','_'));$d=Join-Path $r '.agents/plugins/buzz';New-Item -ItemType Directory -Path $d -Force|Out-Null;try{[IO.File]::WriteAllText((Join-Path $d 'plugin.json'),'{"name":"buzz","displayName":"Buzz turn tools","version":"1.0.0"}');[IO.File]::WriteAllText((Join-Path $d 'mcp_config.json'),[string]$p.mcpConfig);Push-Location $r;try{&{$p.input}|&$c.Source @($p.args);$x=$LASTEXITCODE}finally{Pop-Location}}finally{Remove-Item $d -Recurse -Force -EA 0};exit $x
```

And this `diagnose` process command:

```powershell
$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $c=Get-Command agy.cmd,agy.exe -EA 0 | Select-Object -First 1; [ordered]@{found=[bool]$c; path=if($c){$c.Source}else{$null}; geminiApiKeySet=[bool]$env:GEMINI_API_KEY; googleApiKeySet=[bool]$env:GOOGLE_API_KEY} | ConvertTo-Json -Compress
```

## 5. Per-turn CLI invocation, stream-json parsing, and wrapped MCP send detection

Run `agy` per turn with:

```js
const args = [
  "--input-format", "stream-json",
  "--output-format", "stream-json",
  "--mode", config.approvalMode, // "plan" | "accept-edits" | "auto"
  "--print-timeout", "0",
  "--add-dir", config.workspace,
  ...((delivery.model || config.model) === "default" ? [] : ["--model", delivery.model || config.model]),
  ...(saved.sessionId ? ["--conversation", saved.sessionId] : []),
  "--print=",
];
```

Critical lessons to include:
- Capture `conversation_id` from `event.conversation_id ?? event.init?.conversation_id ?? event.result?.conversation_id ?? event.step_update?.conversation_id` and pass `--conversation <id>` on subsequent turns in the same thread/channel.
- Accumulate `step_update` `text_delta` when `step.step_type === "agent_response"`, and prefer `event.result.response` when `event.event === "result"` completes with `status === "SUCCESS"`.
- Detect Buzz message sends both when `step.tool_name` is directly `send` / `reply_in_subthread` AND when Antigravity wraps the MCP call inside `call_mcp_tool` (`step.tool_info?.parameters?.ToolName` or `params.tool`). Only call `agents.harness.reply` as a fallback when `!state.sentBuzzMessage`.
- Expose models: `default`, `gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`.
- Wrap `agents.storage.set` in `try / catch` so a storage hiccup never turns a completed turn into a failure.

## 6. Automated validation & live in-Buzz acceptance gate

1. Run and pass:
   - `node --check plugin.js`
   - `node verify.mjs` (proving hostile prompt text with quotes, `$()`, semicolons, and emoji stays inert inside the JSON/NDJSON stdin envelope)
   - `node verify-large-prompt.mjs` (proving a >100 KB prompt and `.agents/plugins/buzz/mcp_config.json` reach a mock `agy.cmd` intact)
2. Install or reload the plugin via **Settings > Plugins > Manage plugins > Add > Browse** (after owner approval).
3. Run the **Test Antigravity subscription** probe and confirm `ANTIGRAVITY_SUBSCRIPTION_OK`.
4. Run a live Buzz thread test confirming:
   - exact single reply (no duplicate fallback message);
   - multi-turn `--conversation` session continuity;
   - clean process termination on Stop/cancel.
```

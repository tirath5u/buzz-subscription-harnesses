# One-Shot Prompt: Build, Install & Verify Cursor Agent (Subscription) for Buzz on Windows 11

## Prerequisites Before Pasting

1. **Windows 11** with the **Buzz desktop app** installed.
2. **Node.js 20+** (`node --version`, verified on Node `v24.x`).
3. **Official Cursor Agent CLI (`cursor-agent`)** installed on `PATH` and signed in with your Cursor subscription:
   ```powershell
   cursor-agent --version
   cursor-agent login
   cursor-agent status
   # Confirm output includes: Logged in as ...
   ```
4. **How installation works in Buzz:** Approve or install via **Settings > Plugins > Manage plugins > Add > Browse** (choose `%USERPROFILE%\buzz-subscription-harnesses\cursor-agent-subscription`).

---

## Copy and Paste Everything Below into a Buzz Agent

```markdown
Build, install, test, and verify a production-ready Buzz plugin for Windows 11 named **Cursor Agent (Subscription)** in `%USERPROFILE%\buzz-subscription-harnesses\cursor-agent-subscription`. It must add an Agent Builder harness that drives the user's official, locally installed Cursor Agent CLI (`cursor-agent.cmd` or `agent.cmd`) using their signed-in Cursor subscription—serving **Composer** (`composer-2.5`), **Grok** (`grok-4.7-*`, `cursor-grok-4.6-*`, `cursor-grok-4.5-*`), and **Gemini Argon** (`gemini-4-argon-high`) models via Cursor.

Do not stop after generating files. Carry the work through local validation, installation/reload, agent creation, and a real end-to-end conversation test. Ask the owner only for actions Buzz requires a human to approve, such as first installation or review of changed host permissions/process declarations.

## 1. Non-negotiable authentication and security rules

1. **Do not use a Cursor API key.**
2. **Do not request, read, copy, log, export, or reuse Cursor's stored OAuth tokens or credential files.**
3. Drive only the official `cursor-agent.cmd` (or `agent.cmd`) CLI already installed and logged in by the user.
4. Detect only whether `CURSOR_API_KEY` exists; never read or display its value.
5. Because `CURSOR_API_KEY` overrides login authentication, strip it from every Cursor child process by passing `CURSOR_API_KEY: null` in the spawn environment. Warn the owner once if the variable is present.
6. Verify `event.apiKeySource === "login"` on the `system/init` stream event; if any non-login source is reported, kill the process and fail the turn.
7. Never print MCP Authorization headers, OAuth data, or other secrets in diagnostics or errors. Redact them with a `redact()` helper before surfacing any error.
8. Use only a loopback Buzz MCP server created for the current turn, close it in `finally`, and remove temporary `.cursor-plugin` files in `finally`.

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

- Manifest ID: `community.cursor-agent-subscription`
- Name: `Cursor Agent (Subscription)`
- API version: `1`
- Description: `Run the official logged-in Cursor Agent CLI as a Buzz agent on Windows.`
- Discovery category: `agents`, tags: `["Windows", "Cursor", "subscription", "coding-agents"]`
- Agent type ID: `cursor-agent-subscription`
- Host access: `files: true`, `mcp: true`, and three fixed PowerShell processes (`cursor`, `diagnose`, and `cleanup`).

## 4. Windows launcher: stdin JSON envelope + temp `.cursor-plugin` + sentinel swap + `MAX_PATH` safety

`cursor-agent -p` accepts the prompt over UTF-8 stdin and loads per-turn MCP servers from a plugin directory passed via `--plugin-dir <dir> --approve-mcps --trust`, where `<dir>\.cursor-plugin\plugin.json` points `"mcpServers"` to `"./mcp.json"`.

Critical Windows lessons to implement:
1. **Short `wrapperKey` for Windows PowerShell 5.1 `MAX_PATH` (260 chars):** Never concatenate full agent pubkeys and conversation hashes into `%TEMP%\buzz-cursor-...` — it exceeds 260 characters and causes `New-Item` to fail in Windows PowerShell 5.1. Use `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.
2. **Sentinel swap (`__BUZZ_PLUGIN_DIR__`):** Send `{ args, prompt, mcpConfig, wrapperKey }` as a single UTF-8 JSON envelope over stdin to PowerShell. PowerShell creates `%TEMP%\buzz-cursor-<wrapperKey>\.cursor-plugin\plugin.json` and `mcp.json`, replaces `__BUZZ_PLUGIN_DIR__` in `args` with that temp directory path, and pipes `[string]$p.prompt` over UTF-8 stdin into `& $c.Source @a`.
3. **Out-of-process `cleanup`:** Because killing `powershell.exe` on turn cancellation can prevent its `finally` block from running, declare a tiny `cleanup` PowerShell process and invoke it in JS `finally` with `wrapperKey` so `%TEMP%\buzz-cursor-<wrapperKey>` is always removed.

Use these exact three process declarations in `manifest.json`:

- `cursor`:
  ```powershell
  $ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Text.UTF8Encoding]::new($false);$c=Get-Command cursor-agent.cmd,agent.cmd -EA 0|Select-Object -First 1;if(!$c){exit 127};$p=([Console]::In.ReadToEnd()|ConvertFrom-Json);$r=Join-Path $env:TEMP ('buzz-cursor-'+([string]$p.wrapperKey-replace'[^a-zA-Z0-9._-]','_'));$d=Join-Path $r '.cursor-plugin';New-Item -ItemType Directory $d -Force|Out-Null;try{[IO.File]::WriteAllText("$d\plugin.json",'{"name":"buzz","version":"1.0.0","mcpServers":"./mcp.json"}');[IO.File]::WriteAllText("$r\mcp.json",[string]$p.mcpConfig);$a=@($p.args|%{if($_-eq'__BUZZ_PLUGIN_DIR__'){$r}else{$_}});[string]$p.prompt|&$c.Source @a;exit $LASTEXITCODE}finally{Remove-Item $r -Recurse -Force -EA 0}
  ```
- `diagnose`:
  ```powershell
  $ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$c=Get-Command cursor-agent.cmd,agent.cmd -EA 0|Select-Object -First 1;$status=if($c){&$c.Source status 2>&1|Out-String}else{''};[ordered]@{found=[bool]$c;path=if($c){$c.Source}else{$null};apiKeySet=[bool]$env:CURSOR_API_KEY;loggedIn=($status-match'Logged in as');status=$status.Trim()}|ConvertTo-Json -Compress
  ```
- `cleanup`:
  ```powershell
  $k=[Console]::In.ReadToEnd();$k=$k-replace'[^a-zA-Z0-9._-]','_';Remove-Item (Join-Path $env:TEMP ('buzz-cursor-'+$k)) -Recurse -Force -EA 0
  ```

## 5. Per-turn CLI invocation, models (Composer, Grok, Gemini Argon), and session management

Run Cursor Agent per turn with:

```js
const argsFor = (sessionId) => [
  "-p",
  "--output-format", "stream-json",
  "--trust",
  "--approve-mcps",
  "--plugin-dir", "__BUZZ_PLUGIN_DIR__",
  ...(selectedModel === "auto" ? [] : ["--model", selectedModel]),
  ...(config.permissionMode === "force" ? ["--force"] : []),
  ...(config.permissionMode === "plan" ? ["--mode", "plan"] : []),
  ...(config.permissionMode === "ask" ? ["--mode", "ask"] : []),
  ...(sessionId ? ["--resume", sessionId] : []),
];
```

Expose models covering:
- **Auto:** `auto`
- **Composer:** `composer-2.5`, `composer-2.5-fast`
- **Grok:** `grok-4.7-low`, `grok-4.7-low-fast`, `grok-4.7-medium`, `grok-4.7-medium-fast`, `grok-4.7-high`, `grok-4.7-high-fast`, `grok-4.7-xhigh`, `grok-4.7-xhigh-fast`, `cursor-grok-4.6-*`, `cursor-grok-4.5-*`
- **Gemini Argon:** `gemini-4-argon-high`
- **Other Cursor models:** `gpt-5.3-codex`, `gpt-5.6-sol-high`, `claude-opus-5-5-high`, `claude-opus-5-thinking-high`, `claude-fable-5-thinking-high`, `claude-sonnet-5-thinking-high`

Critical session & reply rules:
- Query `cursor-agent models` asynchronously via `refreshModels()` to populate the model selector automatically when new models ship, with the list above as `FALLBACK_MODELS`.
- Cache `diagnose()` results for 5 minutes so `cursor-agent status` does not add extra startup latency before every turn.
- Track `tool_call` events for Buzz `send` / `reply_in_subthread` and only set `state.sentBuzzMessage = true` on `event.subtype === "completed"` when `!toolCallFailed(event.tool_call)`.
- Key sessions by `community.cursor-agent-subscription/session/${delivery.agent.key}/${encodeURIComponent(conversation.key)}`.
- If a resumed turn fails, clear `sessionId` in storage for the next turn without auto-retrying the failed turn (preventing duplicate side effects).
- Wrap `agents.storage.set` in `try / catch` so storage errors never fail a completed turn.
- Only call `agents.harness.reply` with `state.result.trim()` when `!state.sentBuzzMessage`.

## 6. Automated validation & live in-Buzz acceptance gate

1. Run and pass:
   - `node --check plugin.js`
   - `node verify.mjs` (proving hostile prompt text stays data and `cleanup` deletes `%TEMP%\buzz-cursor-*`)
   - `node verify-large-prompt.mjs` (proving a >100 KB prompt and `__BUZZ_PLUGIN_DIR__` replacement reach a mock `cursor-agent.cmd` intact)
2. Install or reload the plugin via **Settings > Plugins > Manage plugins > Add > Browse** (after owner approval).
3. Run the **Test Cursor subscription** probe and confirm `CURSOR_SUBSCRIPTION_OK`.
4. Run a live Buzz thread test confirming:
   - exact single reply (no duplicate fallback message);
   - multi-turn `--resume` session continuity;
   - clean process termination and temp-dir cleanup on Stop/cancel.
```

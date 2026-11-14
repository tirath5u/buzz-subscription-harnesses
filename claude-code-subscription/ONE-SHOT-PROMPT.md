# One-Shot Prompt: Build, Install & Verify Claude Code (Subscription) for Buzz on Windows 11

## Prerequisites Before Pasting

1. **Windows 11** with the **Buzz desktop app** installed.
2. **Node.js 20+** (`node --version`, verified on Node `v24.x`).
3. **Official Claude Code CLI** (`claude.exe` or `claude.cmd`) installed on `PATH` and signed in with your own Claude Pro/Max subscription:
   ```powershell
   claude --version
   claude
   # Choose "Claude account with subscription" on first run
   ```
4. **How installation works in Buzz:** When the agent finishes building and testing locally, approve or install via **Settings > Plugins > Manage plugins > Add > Browse** (choose `%USERPROFILE%\buzz-subscription-harnesses\claude-code-subscription`).

---

## Copy and Paste Everything Below into a Buzz Agent

```markdown
Build, install, test, and verify a production-ready Buzz plugin for Windows 11 named **Claude Code (Subscription)** in `%USERPROFILE%\buzz-subscription-harnesses\claude-code-subscription`. It must add an Agent Builder harness that runs the user's official, locally installed Claude Code CLI (`claude`) using their existing Claude Pro/Max subscription.

Do not stop after generating files. Carry the work through local validation, installation/reload, agent creation, and a real end-to-end conversation test. Ask the owner only for actions Buzz requires a human to approve, such as first installation or review of changed host permissions/process declarations. After each required approval, continue automatically from where you left off.

## 1. Non-negotiable authentication and security rules

1. **Do not use the Anthropic API.**
2. **Do not request, read, copy, log, export, or reuse Claude's stored OAuth tokens or credentials.**
3. Drive only the official `claude` CLI already installed and logged in by the user.
4. Detect only whether `ANTHROPIC_API_KEY` exists; never read or display its value.
5. Because `ANTHROPIC_API_KEY` overrides subscription authentication, strip it from every Claude child process by passing `ANTHROPIC_API_KEY: null` in the spawn environment. Warn the owner once if the variable is present.
6. Never print MCP Authorization headers, OAuth data, or other secrets in diagnostics or errors. Redact them if an upstream error includes them.
7. Use only a loopback Buzz MCP server created for the current turn, and close it in `finally` when the turn exits, fails, or is cancelled.

## 2. Read the installed Buzz contract first

Before writing code, read Buzz's bundled `plugin_authoring_guide` tool and the locally installed agent/plugin contract. Confirm the exact current signatures for:

- plugin manifest API version `1`;
- `agents.register` and its agent-type fields (`models`, `syncedSettings`, `CreateConfiguration`, `tabs`, `resumes`, `timeoutMs`);
- `agents.harness.conversation`, `systemPrompt`, `turnPrompt`, `tools`, and `reply`;
- `agents.storage` read/set semantics;
- `host.spawn`, `host.serveMcp`, and `host.readFile`;
- settings cards (`ctx.settingsCards.register`) and React access through `ctx.react`;
- process cancellation and delivery lifecycle callbacks (`delivery.acknowledged`, `delivery.interruptible`, `delivery.step`).

The plugin folder must contain:

- `manifest.json`
- one self-contained ES module named `plugin.js`
- `README.md`
- `verify.mjs` and `verify-large-prompt.mjs`

Use plain JavaScript and `React.createElement` from `ctx.react`. Put all runtime setup inside `apply(ctx)` and kill active processes in `ctx.effect` cleanup.

## 3. Plugin identity and discovery

- Manifest ID: `community.claude-code-subscription`
- Name: `Claude Code (Subscription)`
- API version: `1`
- Description: `Run the official logged-in Claude Code CLI as a Buzz agent on Windows.`
- Discovery category: `agents`, tags: `["Windows", "Claude", "subscription", "coding-agents"]`
- Agent type ID: `claude-code-subscription`
- Host access: `files: true`, `mcp: true`, and two fixed PowerShell processes (`claude` and `diagnose`).

## 4. Windows launcher: stdin JSON envelope + temp UTF-8 no-BOM MCP config + sentinel swap

Never pass inline MCP JSON directly as the value of `--mcp-config` through `claude.cmd` — Windows batch parsing strips quotes and corrupts the JSON into broken file paths. Never pass the prompt on the command line where Windows' 32 KiB limit or PowerShell metacharacters can truncate or execute it.

Use this exact transport pattern:

1. Buzz sends one UTF-8 JSON envelope to the declared PowerShell process over stdin:
   - `args`: the Claude argv array containing the sentinel `__BUZZ_MCP_CONFIG__`
   - `prompt`: the full turn prompt
   - `mcpConfig`: serialized MCP configuration JSON
2. PowerShell sets UTF-8 without BOM on `[Console]::InputEncoding`, `[Console]::OutputEncoding`, and `$OutputEncoding`, reads all stdin with `[Console]::In.ReadToEnd() | ConvertFrom-Json`, and resolves `claude.exe` or `claude.cmd` via `Get-Command`.
3. PowerShell writes `mcpConfig` as UTF-8 **without BOM** (`[Text.UTF8Encoding]::new($false)`) to a temporary file (`[IO.Path]::GetTempFileName()`).
4. PowerShell swaps `__BUZZ_MCP_CONFIG__` in `args` with the temp file path, pipes `$p.prompt` over stdin into `& $c.Source @a`, deletes the temp file in `finally`, and exits with `$LASTEXITCODE`.

Use this exact `claude` process command in `manifest.json`:

```powershell
$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Text.UTF8Encoding]::new($false); $c=Get-Command claude.exe,claude.cmd -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){[Console]::Error.WriteLine('BUZZ_CLAUDE_NOT_FOUND'); exit 127}; $p=([Console]::In.ReadToEnd()|ConvertFrom-Json); $f=[IO.Path]::GetTempFileName(); try{[IO.File]::WriteAllText($f,[string]$p.mcpConfig,[Text.UTF8Encoding]::new($false)); $a=@($p.args|ForEach-Object{if($_ -eq '__BUZZ_MCP_CONFIG__'){$f}else{$_}}); & {$p.prompt}|& $c.Source @a; $x=$LASTEXITCODE}finally{Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue}; exit $x
```

And this `diagnose` process command:

```powershell
$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $c=Get-Command claude.exe,claude.cmd | Select-Object -First 1; [ordered]@{found=[bool]$c; path=if($c){$c.Source}else{$null}; apiKeySet=[bool]$env:ANTHROPIC_API_KEY} | ConvertTo-Json -Compress
```

## 5. Per-turn CLI invocation, MCP approval, and completion-gated send tracking

Run Claude headlessly per turn with:

```text
claude -p --output-format stream-json --verbose \
  --model <selected-model> \
  --permission-mode <selected-mode> \
  --mcp-config __BUZZ_MCP_CONFIG__ \
  --strict-mcp-config \
  --allowedTools mcp__buzz \
  [--resume <session_id>]
```

Critical lessons to include:
- Pass `--allowedTools mcp__buzz` so Buzz MCP tools (`send`, `reply_in_subthread`, `read`, etc.) are permitted in `default` permission mode without interactive terminal prompts.
- Instruct the agent in `systemPrompt`:
  `Use Buzz MCP tools for all conversation messages and attachments. Report file edits with their paths; Buzz shows tool activity live.`
- Track `tool_use` items matching `send` / `reply_in_subthread` / `messages_send` in a `pendingSends` `Set` by `item.id`, and only set `state.sentBuzzMessage = true` when the matching `user` `tool_result` arrives with `item.is_error !== true`. If a tool call is rejected or fails, or if the model replies in plain text without calling `send`, publish `state.result.trim()` via `agents.harness.reply`.
- Expose model aliases (`sonnet`, `opus`, `fable`, `haiku`) as well as explicit IDs (`claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`).

## 6. Session persistence & state-save resilience

- Key sessions by `community.claude-code-subscription/session/${delivery.agent.key}/${encodeURIComponent(conversation.key)}`.
- Maintain an in-memory session map alongside `agents.storage` so a transient storage write error after a successful turn never turns a completed reply into a false failure. Wrap `agents.storage.set` in its own `try / catch`.

## 7. Automated validation & live in-Buzz acceptance gate

1. Run and pass:
   - `node --check plugin.js`
   - `node verify.mjs` (proving hostile prompt text with quotes, `$()`, semicolons, and emoji is never evaluated by PowerShell)
   - `node verify-large-prompt.mjs` (proving a >100 KB prompt and temp MCP config reach a mock `claude.cmd` intact)
2. Install or reload the plugin via **Settings > Plugins > Manage plugins > Add > Browse** (after owner approval).
3. Run the **Test Claude subscription** probe and confirm `apiKeySource=none`.
4. Run a live Buzz thread test confirming:
   - exact single reply (no duplicate fallback message);
   - multi-turn `--resume` session continuity (recalling a nonce from turn 1 on turn 2);
   - clean process termination on Stop/cancel.
```

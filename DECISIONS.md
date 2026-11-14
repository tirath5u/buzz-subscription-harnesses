# Decisions

Short decision records: the context, what I decided, why, and what it cost. Newest decisions are at the bottom.

---

### D1: Drive vendors' official signed-in CLIs, not raw APIs or tokens

- **Context:** Users maintain personal or professional AI subscriptions (Claude Pro/Max, Cursor, etc.) that provide official developer CLIs (`claude`, `cursor-agent`). Buzz agents need access to these models without requiring separate pay-per-token API keys.
- **Decision:** Drive the vendors' official installed CLIs in headless print mode (`-p` / `--output-format stream-json`) using the user's existing login state on Windows 11.
- **Why:** Reuses existing, authorized subscription sessions without asking users to copy, paste, or expose credentials, avoiding separate metered API costs.
- **Trade-off:** Relies on vendor CLI availability, updates, and local platform behavior; subject to subscription rate limits and concurrency policies.

---

### D2: Strip API-key env vars; never read stored tokens

- **Context:** Developers often have API-key environment variables (`ANTHROPIC_API_KEY`, `CURSOR_API_KEY`) set globally. If passed to child CLIs, these variables override subscription authentication and incur metered billing. Moreover, reading stored credential vaults creates significant security and privacy risks.
- **Decision:** Strip the provider's API-key variable (`ANTHROPIC_API_KEY` for Claude, `CURSOR_API_KEY` for Cursor) from every test and turn process, and warn the user once if it is set. Never inspect, read, copy, or export stored token files, keychains, or OAuth databases.
- **Why:** Guarantees that child processes exclusively use local signed-in subscription sessions, prevents unexpected API billing, and maintains zero-knowledge privacy.
- **Trade-off:** If a user is not signed in via the CLI, the process fails immediately with a clear login prompt rather than falling back to an existing API key.

---

### D3: UTF-8 stdin envelope for prompts (Windows quoting and command-line length limits)

- **Context:** Windows command-line invocations (`cmd.exe` batch files and PowerShell arguments) suffer from rigid length limits (8,191 characters for `cmd.exe`; 32,767 for Windows API) and fragile escaping rules that corrupt quotes, semicolons, and Unicode characters.
- **Decision:** Send the prompt and MCP config as one UTF-8 JSON envelope on stdin (`[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)`). The launcher pipes the prompt to the CLI's stdin and writes the MCP config to a temporary UTF-8 no-BOM file, swapped in for a sentinel argument and deleted after the turn.
- **Why:** Prompt text never reaches a command line or the PowerShell parser, so it can't be run as code or corrupted by quoting, and size is not limited by the command line. `verify.mjs` and `verify-large-prompt.mjs` check both (hostile text, >100 KB).
- **Trade-off:** Requires a compact PowerShell host wrapper to unpack the stdin JSON envelope before handing data to the target CLI.

---

### D4: Gemini CLI rejected for consumer accounts (UNSUPPORTED_CLIENT); tried Antigravity CLI

- **Context:** The official standalone Google Gemini CLI (`gemini`) was tested with consumer Google accounts, but rejected headless requests with `UNSUPPORTED_CLIENT` errors.
- **Decision:** Explored Google Antigravity's `agy` CLI as a potential alternative, verifying that it supported headless `stream-json` execution with logged-in accounts.
- **Why:** Investigated whether consumer Google accounts could participate in local Buzz multi-agent cross-checking.
- **Trade-off:** Led directly to evaluating Google's terms of service regarding third-party wrappers (see D5).

---

### D5: REMOVED the Antigravity plugin (Nov 15, 2026)

- **Context:** Google's [Antigravity FAQ](https://antigravity.google/docs/faq/) says: "Using third-party software, tools, or services to access Antigravity is a violation of our Terms of Service," that this "can result in suspension or termination of your account," and that wrapping `agy` inside third-party coding agents or applications "is not supported under consumer plans."
- **Decision:** Completely removed the `antigravity-subscription` plugin from this repository on November 15, 2026.
- **Why:** Although the integration functioned technically, publishing a harness that risks user account suspension violates the safety goals of this project. For direct Gemini usage, Google recommends an AI Studio or Gemini Enterprise API key.
- **Trade-off:** Direct access to Gemini 3.8 Flash via subscription is removed. Gemini 4 Argon remains accessible via the Cursor Agent (Subscription) harness.

---

### D6: Hostile-prompt and >100 KB verification gates before trusting a harness

- **Context:** Windows batch wrappers frequently fail silently on edge cases involving special characters, multiline text, or payload size limits.
- **Decision:** Require automated pre-installation test gates (`verify.mjs` and `verify-large-prompt.mjs`) for every plugin in the repository.
- **Why:** Proves that hostile prompt text (containing quotes, semicolons, `$()`, and Unicode) remains pure data without triggering injection markers, and confirms that payloads exceeding 100 KB reach child processes intact.
- **Trade-off:** Requires Node.js test scripts and local test fixtures in each plugin directory.

---

### D7: Roles by model strength (see use-case doc); Cursor terms open risk

- **Context:** Frontier models exhibit distinct strengths and failure profiles. Furthermore, platform terms regarding third-party hosting vary across providers.
- **Decision:** Define structured cross-model review loops around specific complementary model roles (documented in `docs/ASK-REGS-SOR-USE-CASE.md`). Explicitly document Cursor's terms for third-party hosting as an unconfirmed open risk.
- **Why:** Focuses multi-agent collaboration where it adds the greatest verification value, while being transparent about open licensing questions.
- **Trade-off:** Users must review vendor terms and assume responsibility for operating their accounts.

---

### D8: Pre-approve only Buzz's tools, and never let an agent go silent

- **Context:** Headless CLIs can't show approval prompts. In testing, Claude refused every Buzz `send` ("Claude requested permissions to use mcp__buzz__send"), and Cursor in `default` mode rejected them ("User rejected MCP"). The plugins also counted an attempted post as delivered, so the agent's answer was dropped and nothing appeared in the thread.
- **Decision:** Pre-approve only the Buzz MCP server: `--allowedTools mcp__buzz` for Claude, and the workspace rule `Mcp(plugin-buzz-*-buzz:*)` in `.cursor/cli.json` for Cursor, which has no per-run flag. Count a post as sent only after the tool reports success; otherwise post the model's final text.
- **Why:** Agents must be able to reply without granting blanket permissions. Shell and file edits still follow each agent's permission mode.
- **Trade-off:** Cursor's rule lives in the working folder's config, not in the plugin, so each working folder needs it once.

---

### D9: Read the Cursor model list from the CLI

- **Context:** A hard-coded model list hid models the subscription already included (all Grok and Composer variants) and went stale as new models shipped.
- **Decision:** Build the model picker from `cursor-agent models` when the plugin starts and when settings open, with a built-in list as fallback.
- **Why:** New models appear in Buzz without a plugin release.
- **Trade-off:** Depends on the CLI's text output format; if it changes, the picker falls back to the built-in list until the parser is updated.

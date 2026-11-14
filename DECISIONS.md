# Architecture & Project Decisions (ADRs)

Architectural Decision Records (ADRs) documenting key choices, rationale, and trade-offs for the Buzz subscription agent harnesses.

---

### D1: Drive vendors' official signed-in CLIs, not raw APIs or tokens

- **Context:** Users maintain personal or professional AI subscriptions (Claude Pro/Max, Cursor, etc.) that provide official developer CLIs (`claude`, `cursor-agent`). Buzz agents need access to these models without requiring separate pay-per-token API keys.
- **Decision:** Drive the vendors' official installed CLIs in headless print mode (`-p` / `--output-format stream-json`) using the user's existing login state on Windows 11.
- **Why:** Reuses existing, authorized subscription sessions without asking users to copy, paste, or expose credentials, avoiding separate metered API costs.
- **Trade-off:** Relies on vendor CLI availability, updates, and local platform behavior; subject to subscription rate limits and concurrency policies.

---

### D2: Strip API-key env vars; never read stored tokens

- **Context:** Developers often have API-key environment variables (`ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`) set globally. If passed to child CLIs, these variables override subscription authentication and incur metered billing. Moreover, reading stored credential vaults creates significant security and privacy risks.
- **Decision:** Explicitly strip all API-key environment variables (`ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`) from every test and turn child process. Never inspect, read, copy, or export stored token files, keychains, or OAuth databases.
- **Why:** Guarantees that child processes exclusively use local signed-in subscription sessions, prevents unexpected API billing, and maintains zero-knowledge privacy.
- **Trade-off:** If a user is not signed in via the CLI, the process fails immediately with a clear login prompt rather than falling back to an existing API key.

---

### D3: UTF-8 stdin envelope for prompts (Windows quoting and command-line length limits)

- **Context:** Windows command-line invocations (`cmd.exe` batch files and PowerShell arguments) suffer from rigid length limits (8,191 characters for `cmd.exe`; 32,767 for Windows API) and fragile escaping rules that corrupt quotes, semicolons, and Unicode characters.
- **Decision:** Pass prompts and configuration over a UTF-8 stdin JSON envelope (`[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)`) or temporary UTF-8 no-BOM files (`prompt.md`, `mcp.json`) with sentinel replacement.
- **Why:** Eliminates shell injection vulnerabilities, avoids command-line quoting corruption, and supports arbitrarily large prompts (>100 KB) without truncation.
- **Trade-off:** Requires a compact PowerShell host wrapper to unpack the stdin JSON envelope before handing data to the target CLI.

---

### D4: Gemini CLI rejected for consumer accounts (UNSUPPORTED_CLIENT); tried Antigravity CLI

- **Context:** The official standalone Google Gemini CLI (`gemini`) was tested with consumer Google accounts, but rejected headless requests with `UNSUPPORTED_CLIENT` errors.
- **Decision:** Explored Google Antigravity's `agy` CLI as a potential alternative, verifying that it supported headless `stream-json` execution with logged-in accounts.
- **Why:** Investigated whether consumer Google accounts could participate in local Buzz multi-agent cross-checking.
- **Trade-off:** Led directly to evaluating Google's terms of service regarding third-party wrappers (see D5).

---

### D5: REMOVED the Antigravity plugin (Nov 15, 2026)

- **Context:** Google's Antigravity FAQ ([https://antigravity.google/docs/faq/](https://antigravity.google/docs/faq/)) states that third-party software accessing an Antigravity login violates its Terms of Service and can lead to account suspension, and wrapping `agy` in third-party applications is not supported on consumer plans.
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

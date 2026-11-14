export const inject = ["react", "agents", "host", "settingsCards"];

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const { agents, host } = ctx;
  const TYPE_ID = "cursor-agent-subscription";
  const DEFAULT_CONFIG = {
    model: "auto",
    permissionMode: "default",
    workspace: "~/.buzz",
    scope: "thread",
    instructions: "",
  };
  const FALLBACK_MODELS = [
    {
      "id": "auto",
      "label": "Auto"
    },
    {
      "id": "grok-4.7-low",
      "label": "Grok 4.7 Low"
    },
    {
      "id": "grok-4.7-low-fast",
      "label": "Grok 4.7 Low Fast"
    },
    {
      "id": "grok-4.7-medium",
      "label": "Grok 4.7 Medium"
    },
    {
      "id": "grok-4.7-medium-fast",
      "label": "Grok 4.7 Medium Fast"
    },
    {
      "id": "grok-4.7-high",
      "label": "Grok 4.7 High"
    },
    {
      "id": "grok-4.7-high-fast",
      "label": "Grok 4.7 High Fast"
    },
    {
      "id": "grok-4.7-xhigh",
      "label": "Grok 4.7 Extra High"
    },
    {
      "id": "grok-4.7-xhigh-fast",
      "label": "Grok 4.7 Extra High Fast"
    },
    {
      "id": "cursor-grok-4.6-low",
      "label": "Grok 4.6 Low"
    },
    {
      "id": "cursor-grok-4.6-low-fast",
      "label": "Grok 4.6 Low Fast"
    },
    {
      "id": "cursor-grok-4.6-medium",
      "label": "Grok 4.6 Medium"
    },
    {
      "id": "cursor-grok-4.6-medium-fast",
      "label": "Grok 4.6 Medium Fast"
    },
    {
      "id": "cursor-grok-4.6-high",
      "label": "Grok 4.6 High"
    },
    {
      "id": "cursor-grok-4.6-high-fast",
      "label": "Grok 4.6 High Fast"
    },
    {
      "id": "cursor-grok-4.6-xhigh",
      "label": "Grok 4.6 Extra High"
    },
    {
      "id": "cursor-grok-4.6-xhigh-fast",
      "label": "Grok 4.6 Extra High Fast"
    },
    {
      "id": "cursor-grok-4.5-low",
      "label": "Grok 4.5 Low"
    },
    {
      "id": "cursor-grok-4.5-low-fast",
      "label": "Grok 4.5 Low Fast"
    },
    {
      "id": "cursor-grok-4.5-medium",
      "label": "Grok 4.5 Medium"
    },
    {
      "id": "cursor-grok-4.5-medium-fast",
      "label": "Grok 4.5 Medium Fast"
    },
    {
      "id": "cursor-grok-4.5-high",
      "label": "Grok 4.5 High"
    },
    {
      "id": "cursor-grok-4.5-high-fast",
      "label": "Grok 4.5 High Fast"
    },
    {
      "id": "composer-2.5",
      "label": "Composer 2.5"
    },
    {
      "id": "composer-2.5-fast",
      "label": "Composer 2.5 Fast"
    },
    {
      "id": "gpt-5.3-codex",
      "label": "GPT-5.3 Codex"
    },
    {
      "id": "gpt-5.6-sol-high",
      "label": "GPT-5.6 Sol High"
    },
    {
      "id": "claude-opus-5-5-high",
      "label": "Claude Opus 5.5 High"
    },
    {
      "id": "claude-opus-5-thinking-high",
      "label": "Claude Opus 5 Thinking"
    },
    {
      "id": "claude-fable-5-thinking-high",
      "label": "Claude Fable 5 Thinking"
    },
    {
      "id": "claude-sonnet-5-thinking-high",
      "label": "Claude Sonnet 5 Thinking"
    },
    {
      "id": "gemini-4-argon-high",
      "label": "Gemini 4 Argon High"
    }
  ];
  let discoveredModels = FALLBACK_MODELS;
  let modelRefreshPromise;
  let diagnosticCache;
  let diagnosticPromise;
  let diagnosticCachedAt = 0;
  const activeProcesses = new Set();
  const apiKeyWarned = new Set();

  ctx.effect(() => {
    void refreshModels();
    void diagnose();
    return () => {
      for (const process of activeProcesses) void process.kill();
      activeProcesses.clear();
    };
  });

  function normalized(value) {
    const raw = value && typeof value === "object" ? value : {};
    return {
      // Passed to the CLI as an argument: accept only id-shaped values, never something that reads as a flag.
      model: typeof raw.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._\-[\]=,]{0,119}$/.test(raw.model.trim()) ? raw.model.trim() : "auto",
      permissionMode: ["default", "force", "plan", "ask"].includes(raw.permissionMode)
        ? raw.permissionMode
        : "default",
      workspace: typeof raw.workspace === "string" && raw.workspace.trim()
        ? raw.workspace.trim()
        : DEFAULT_CONFIG.workspace,
      scope: raw.scope === "channel" ? "channel" : "thread",
      instructions: typeof raw.instructions === "string" ? raw.instructions : "",
    };
  }

  function redact(text) {
    return String(text ?? "")
      .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
      .replace(/(CURSOR_API_KEY\s*[:=]\s*)[^\s"']+/gi, "$1[REDACTED]");
  }

  function isBuzzSendName(value) {
    const name = String(value ?? "");
    return /^(messages?_send|send|reply_in_subthread)$/i.test(name)
      || (/buzz/i.test(name) && /(^|[_.:/-])(messages?_send|send|reply_in_subthread)$/i.test(name));
  }

  function toolNames(value, names = []) {
    if (!value || typeof value !== "object") return names;
    for (const [key, item] of Object.entries(value)) {
      if (["tool", "name", "toolName", "tool_name"].includes(key) && typeof item === "string") names.push(item);
      else if (item && typeof item === "object") toolNames(item, names);
    }
    return names;
  }

  function toolCallFailed(value) {
    if (!value || typeof value !== "object") return false;
    for (const [key, item] of Object.entries(value)) {
      if (["rejected", "error", "failure", "failed"].includes(key.toLowerCase()) && item) return true;
      if (item && typeof item === "object" && toolCallFailed(item)) return true;
    }
    return false;
  }

  async function captureProcess(id, options = {}) {
    if (!host.spawn) throw new Error("Process launching is unavailable. Use the Buzz desktop app.");
    let stdout = "";
    let stderr = "";
    const { input, onProcess, ...spawnOptions } = options;
    const process = await host.spawn(id, {
      ...spawnOptions,
      onStdout(data) {
        stdout += data;
        options.onStdout?.(data);
      },
      onStderr(data) {
        stderr += data;
        options.onStderr?.(data);
      },
    });
    activeProcesses.add(process);
    onProcess?.(process);
    if (input !== undefined) await process.end(input);
    const code = await process.exited.finally(() => activeProcesses.delete(process));
    return { code, stdout, stderr };
  }

  function parseModels(text) {
    const models = [];
    const seen = new Set();
    for (const line of String(text ?? "").split(/\r?\n/)) {
      const match = line.match(/^([^\s]+)\s+-\s+(.+?)\s*$/);
      if (!match || match[1] === "Available" || seen.has(match[1])) continue;
      seen.add(match[1]);
      models.push({ id: match[1], label: match[2].replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s*\((?:current|default)(?:,\s*(?:current|default))*\)\s*$/i, "").replace(/\s+/g, " ").trim() });
    }
    return models;
  }

  function availableModels(current) {
    const models = [...discoveredModels];
    if (current && !models.some((model) => model.id === current))
      models.unshift({ id: current, label: `${current} (configured)` });
    return models;
  }

  async function refreshModels() {
    if (modelRefreshPromise) return modelRefreshPromise;
    modelRefreshPromise = (async () => {
      try {
        const result = await captureProcess("cursor", {
          input: JSON.stringify({ args: ["models"], prompt: "", mcpConfig: "{\"mcpServers\":{}}", wrapperKey: "model-discovery" }),
          env: { CURSOR_API_KEY: null, PYTHONIOENCODING: "utf-8" },
        });
        const models = parseModels(result.stdout);
        if (result.code === 0 && models.length) discoveredModels = models;
      } catch { /* retain the built-in fallback list */ }
      return discoveredModels;
    })().finally(() => { modelRefreshPromise = undefined; });
    return modelRefreshPromise;
  }

  async function diagnose({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && diagnosticCache && now - diagnosticCachedAt < 5 * 60 * 1000) return diagnosticCache;
    if (!fresh && diagnosticPromise) return diagnosticPromise;
    diagnosticPromise = (async () => {
      try {
        const result = await captureProcess("diagnose", {});
        const line = result.stdout.trim().split(/\r?\n/).findLast(Boolean);
        const parsed = line ? JSON.parse(line) : {};
        diagnosticCache = {
          found: parsed.found === true,
          path: typeof parsed.path === "string" ? parsed.path : "",
          apiKeySet: parsed.apiKeySet === true,
          loggedIn: parsed.loggedIn === true,
          status: typeof parsed.status === "string" ? parsed.status : "",
          error: result.code === 0 ? "" : result.stderr.trim(),
        };
      } catch (error) {
        diagnosticCache = { found: false, path: "", apiKeySet: false, loggedIn: false, status: "", error: String(error) };
      }
      diagnosticCachedAt = Date.now();
      return diagnosticCache;
    })().finally(() => { diagnosticPromise = undefined; });
    return diagnosticPromise;
  }

  function inspectEvent(event, state, delivery) {
    if (!event || typeof event !== "object") return;
    if (typeof event.session_id === "string" && event.session_id.trim())
      state.sessionId = event.session_id.trim();

    if (event.type === "system" && event.subtype === "init") {
      state.sawInit = true;
      if (event.apiKeySource === "login") state.loginAuth = true;
      else if (typeof event.apiKeySource === "string") state.apiKeyRejected = true;
      return;
    }
    if (event.type === "assistant") {
      const content = event.message?.content;
      if (!Array.isArray(content)) return;
      for (const item of content) {
        if (item?.type === "text" && typeof item.text === "string" && item.text.trim())
          state.lastAssistantText = item.text.trim();
        if (item?.type === "tool_use") {
          const input = item.input && typeof item.input === "object" ? item.input : {};
          const target = input.file_path ?? input.path ?? input.command ?? input.pattern;
          delivery?.step?.(String(item.name ?? "Tool"), target == null ? undefined : String(target).slice(0, 500));
        }
      }
      return;
    }
    if (event.type === "tool_call") {
      const names = toolNames(event.tool_call);
      // Only a real MCP call posts. getMcpToolsToolCall (a schema lookup) also names "send" and must not count.
      const isBuzzSend = Boolean(event.tool_call?.mcpToolCall) && names.some(isBuzzSendName);
      if (event.subtype === "started") {
        if (isBuzzSend && event.call_id) (state.pendingBuzzSends ??= new Set()).add(event.call_id);
        delivery?.step?.(names.at(-1) ?? "Tool");
      } else if (event.subtype === "completed" && isBuzzSend) {
        if (event.call_id) state.pendingBuzzSends?.delete(event.call_id);
        if (!toolCallFailed(event.tool_call)) state.sentBuzzMessage = true;
      }
      return;
    }
    if (event.type === "result") {
      state.sawResult = true;
      state.isError = event.is_error === true;
      state.result = state.lastAssistantText || (typeof event.result === "string" ? event.result : "");
      if (event.service_tier === "standard") state.standardTier = true;
      if (event.modelUsage && typeof event.modelUsage === "object") {
        for (const usage of Object.values(event.modelUsage)) {
          if (usage?.service_tier === "standard") state.standardTier = true;
        }
      }
    }
    // Unknown and hook_* events are intentionally ignored.
  }

  async function runProbe() {
    const diagnostic = await diagnose();
    if (!diagnostic.found) return { ok: false, text: "Cursor Agent CLI was not found. Install the official Windows CLI, then run `cursor-agent login`." };
    if (!diagnostic.loggedIn) return { ok: false, text: "Cursor Agent is installed but not authenticated. Run `cursor-agent login` in PowerShell." };
    const state = {};
    let probeProcess;
    let buffer = "";
    const consume = (data) => {
      buffer += data;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          inspectEvent(JSON.parse(line), state);
          if (state.apiKeyRejected) void probeProcess?.kill();
        } catch { /* non-JSON diagnostic output */ }
      }
    };
    const probeArgs = ["-p", "--output-format", "stream-json", "--mode", "ask", "--trust", "--approve-mcps", "--plugin-dir", "__BUZZ_PLUGIN_DIR__"];
    const result = await captureProcess("cursor", {
      input: JSON.stringify({ args: probeArgs, prompt: "Reply with exactly CURSOR_SUBSCRIPTION_OK", mcpConfig: "{\"mcpServers\":{}}", wrapperKey: "subscription-probe" }),
      env: { CURSOR_API_KEY: null, PYTHONIOENCODING: "utf-8" },
      onProcess(value) { probeProcess = value; },
      onStdout: consume,
    });
    if (buffer.trim()) { try { inspectEvent(JSON.parse(buffer), state); } catch { /* ignored */ } }
    const warning = diagnostic.apiKeySet ? " Warning: CURSOR_API_KEY is set in your environment; this plugin removes it from every test and turn process." : "";
    if (state.apiKeyRejected) return { ok: false, text: "Cursor did not report login authentication, so the subscription test was stopped." };
    if (result.code !== 0 || state.isError || !state.sawResult || state.result.trim() !== "CURSOR_SUBSCRIPTION_OK") {
      return { ok: false, text: `Cursor started but the signed-in account test failed: ${(result.stderr || state.result || `exit ${result.code}`).trim()}${warning}` };
    }
    return { ok: true, text: `Cursor Agent completed a headless stream-json turn using login authentication.${warning}` };
  }

  function Fields({ config, onChange, disabled = false }) {
    const value = normalized(config);
    const [models, setModels] = React.useState(() => availableModels(value.model));
    React.useEffect(() => {
      let live = true;
      void refreshModels().then(() => { if (live) setModels(availableModels(value.model)); });
      return () => { live = false; };
    }, [value.model]);
    const field = (label, control) => h("label", { style: { display: "grid", gap: "var(--space-1)" } }, h("span", null, label), control);
    return h("div", { style: { display: "grid", gap: "var(--space-3)" } },
      field("Model", h("select", { value: value.model, disabled, onChange: (event) => onChange({ ...value, model: event.target.value }) },
        ...models.map((m) => h("option", { key: m.id, value: m.id }, m.label)))),
      field("Permission mode", h("select", { value: value.permissionMode, disabled, onChange: (event) => onChange({ ...value, permissionMode: event.target.value }) },
        h("option", { value: "force" }, "Force / run everything (unsafe)"),
        h("option", { value: "default" }, "Default"),
        h("option", { value: "plan" }, "Plan only"),
        h("option", { value: "ask" }, "Ask / read-only"))),
      field("Working folder", h("input", { value: value.workspace, disabled, spellCheck: false, onChange: (event) => onChange({ ...value, workspace: event.target.value }) })),
      field("Agent instructions", h("textarea", { value: value.instructions, disabled, rows: 6, placeholder: "Describe this agent's role, responsibilities, and working style.", onChange: (event) => onChange({ ...value, instructions: event.target.value }) })),
      field("Conversation scope", h("select", { value: value.scope, disabled, onChange: (event) => onChange({ ...value, scope: event.target.value }) },
        h("option", { value: "thread" }, "One Cursor session per thread"),
        h("option", { value: "channel" }, "One Cursor session per channel")))
    );
  }

  function TestPanel() {
    const [status, setStatus] = React.useState({ running: false, text: "" });
    const test = async () => {
      setStatus({ running: true, text: "Running Cursor Agent without CURSOR_API_KEY..." });
      const result = await runProbe();
      setStatus({ running: false, text: result.text, ok: result.ok });
    };
    return h("div", { className: "ui-card", style: { padding: "var(--space-panel-inset)", display: "grid", gap: "var(--space-2)" } },
      h("h3", null, "Subscription test"),
      h("p", null, "Runs the official Cursor Agent CLI. It never reads or copies Cursor's stored credentials."),
      h("button", { type: "button", disabled: status.running, onClick: test }, status.running ? "Testing..." : "Test Cursor subscription"),
      status.text ? h("p", { role: "status" }, status.text) : null
    );
  }

  function CreateConfiguration({ config, onChange, disabled, harnessControl, onReadyChange }) {
    React.useEffect(() => { onReadyChange?.(true); }, [onReadyChange]);
    return h("div", { style: { display: "grid", gap: "var(--space-3)" } }, harnessControl, h(Fields, { config, onChange, disabled }));
  }

  function SettingsTab({ agent, save, settingsContent }) {
    const [draft, setDraft] = React.useState(() => normalized(agent.config));
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState("");
    React.useEffect(() => setDraft(normalized(agent.config)), [agent.config]);
    const submit = async () => {
      setSaving(true); setMessage("");
      try { await save(draft); setMessage("Saved."); }
      catch (error) { setMessage(String(error)); }
      finally { setSaving(false); }
    };
    return h("section", { style: { display: "grid", gap: "var(--space-4)", padding: "var(--space-panel-inset)" } },
      settingsContent,
      h(Fields, { config: draft, onChange: setDraft, disabled: saving }),
      h("div", null, h("button", { type: "button", disabled: saving, onClick: submit }, saving ? "Saving..." : "Save settings")),
      message ? h("p", { role: "status" }, message) : null,
      h(TestPanel)
    );
  }

  function GlobalSettings() {
    const [diagnostic, setDiagnostic] = React.useState(null);
    React.useEffect(() => { let live = true; void diagnose().then((value) => live && setDiagnostic(value)); return () => { live = false; }; }, []);
    return h("section", { style: { display: "grid", gap: "var(--space-4)" } },
      h("h2", null, "Cursor Agent (Subscription)"),
      diagnostic === null ? h("p", null, "Checking Cursor Agent CLI...")
        : !diagnostic.found ? h("p", { role: "alert" }, "Cursor Agent CLI was not found. Install the official Windows CLI, then run `cursor-agent login`.")
        : !diagnostic.loggedIn ? h("p", { role: "alert" }, "Cursor Agent is installed but not logged in. Run `cursor-agent login` in PowerShell.")
        : h("div", null,
            h("p", null, `Found logged-in Cursor Agent at ${diagnostic.path}.`),
            diagnostic.apiKeySet ? h("p", { role: "alert" }, "Warning: CURSOR_API_KEY is set and normally overrides login. This plugin removes it from Cursor test and turn processes.") : h("p", null, "CURSOR_API_KEY is not set.")),
      h(TestPanel)
    );
  }

  ctx.settingsCards.register({ id: "cursor-subscription", title: "Cursor Agent (Subscription)", group: "Plugins", component: GlobalSettings });

  agents.register({
    id: TYPE_ID,
    title: "Cursor Agent (Subscription)",
    description: "Official Cursor Agent CLI using your logged-in Cursor account on Windows.",
    defaults: () => ({ config: DEFAULT_CONFIG }),
    carry: (saved) => {
      const value = normalized(saved);
      return {
        ...(value.instructions.trim() ? { instructions: value.instructions } : {}),
        ...(value.workspace !== DEFAULT_CONFIG.workspace ? { workspace: value.workspace } : {}),
      };
    },
    adopt: (carry, saved) => ({
      ...normalized(saved),
      instructions: carry.instructions ?? normalized(saved).instructions,
      workspace: carry.workspace ?? normalized(saved).workspace,
    }),
    summary: (agent) => `Cursor ${normalized(agent.config).model}`,
    CreateConfiguration,
    createModelReportsReadiness: true,
    models: (agent) => ({
      current: normalized(agent.config).model,
      models: availableModels(normalized(agent.config).model).map((m) => ({ ...m, efforts: [] })),
    }),
    syncedSettings: {
      schema: {
        model: "string",
        permissionMode: ["default", "force", "plan", "ask"],
        workspace: "string",
        scope: ["thread", "channel"],
      },
      withSynced(saved, settings) {
        const local = normalized(saved);
        return normalized({
          ...local,
          model: settings.model ?? DEFAULT_CONFIG.model,
          permissionMode: settings.permissionMode ?? DEFAULT_CONFIG.permissionMode,
          workspace: settings.workspace ?? DEFAULT_CONFIG.workspace,
          scope: settings.scope ?? DEFAULT_CONFIG.scope,
        });
      },
    },
    tabs: [{ id: "settings", title: "Settings", role: "settings", component: SettingsTab }],
    timeoutMs: 30 * 60 * 1000,
    resumes: true,
    async run(delivery) {
      const config = normalized(delivery.config);
      const conversation = await agents.harness.conversation(delivery, config.scope);
      if (!conversation) { delivery.ignored?.(); return; }

      const diagnostic = await diagnose();
      if (!diagnostic.found) {
        await agents.harness.reply(delivery.agent, conversation,
          "Cursor Agent CLI was not found. Install the official Windows CLI, then run `cursor-agent login`.",
          { notifyOwner: true });
        throw new Error("Cursor Agent CLI not found");
      }
      if (!diagnostic.loggedIn) {
        await agents.harness.reply(delivery.agent, conversation,
          "Cursor Agent is installed but not authenticated. Run `cursor-agent login` in PowerShell.",
          { notifyOwner: true });
        throw new Error("Cursor Agent is not logged in");
      }
      if (diagnostic.apiKeySet && !apiKeyWarned.has(delivery.agent.key)) {
        apiKeyWarned.add(delivery.agent.key);
        await agents.harness.reply(delivery.agent, conversation,
          "Warning: `CURSOR_API_KEY` is set and normally overrides login. This plugin removes it from Cursor turn processes, so this run uses the signed-in Cursor account.");
      }

      const sessionKey = `community.cursor-agent-subscription/session/${delivery.agent.key}/${encodeURIComponent(conversation.key)}`;
      let saved = {};
      try { saved = JSON.parse((await agents.storage.read(sessionKey)) ?? "{}"); } catch { /* start a new session */ }
      const system = await agents.harness.systemPrompt(delivery, {
        scope: config.scope,
        cwd: config.workspace,
        instructions: [
          config.instructions.trim(),
          "Use Buzz MCP tools for all conversation messages and attachments. Report file edits with their paths; Buzz shows tool activity live. Your final `send` (with `final: true`) ends the turn: stop immediately after it and write no closing summary, because nothing after it is shown. Answer from the context you already have; only run tools when the request needs them.",
        ].filter(Boolean).join("\n\n"),
        tools: true,
      });
      const turn = await agents.harness.turnPrompt(delivery, conversation, { cursor: saved.cursor });
      const prompt = saved.sessionId ? turn.text : `${system}\n\n${turn.text}`;
      const mcp = await host.serveMcp(agents.harness.tools(delivery.agent, conversation, {
        read: (path) => host.readFile(path, { cwd: config.workspace }),
      }));
      const mcpConfig = JSON.stringify({
        mcpServers: {
          buzz: {
            type: "http",
            url: mcp.url,
            headers: Object.fromEntries(mcp.headers.map(({ name, value }) => [name, value])),
          },
        },
      });
      const selectedModel = delivery.model || config.model;
      // Short on purpose: Windows PowerShell 5.1 has a 260-char path limit, and agent+conversation keys overflowed it.
      const wrapperKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
      let process;
      let accepted = false;
      let abort;
      const stop = async () => { if (process) await process.kill(); };

      const execute = async (sessionId, promptText) => {
        const state = {};
        let buffer = "";
        const consume = (data) => {
          buffer += data;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            try {
              inspectEvent(JSON.parse(line), state, delivery);
              if (state.apiKeyRejected) void process?.kill();
            } catch { /* ignore non-JSON output */ }
          }
        };
        process = await host.spawn("cursor", {
          cwd: config.workspace,
          env: { CURSOR_API_KEY: null, PYTHONIOENCODING: "utf-8" },
          onStdout: consume,
          onStderr(data) { state.stderr = `${state.stderr ?? ""}${data}`.slice(-16000); },
        });
        activeProcesses.add(process);
        await process.end(JSON.stringify({ args: argsFor(sessionId), prompt: promptText, mcpConfig, wrapperKey }));
        if (!accepted) {
          delivery.acknowledged?.();
          accepted = true;
          delivery.interruptible?.(stop);
          abort = () => void stop();
          delivery.signal.addEventListener("abort", abort, { once: true });
        }
        const code = await process.exited;
        activeProcesses.delete(process);
        if (buffer.trim()) { try { inspectEvent(JSON.parse(buffer), state, delivery); } catch { /* ignored */ } }
        return { code, state };
      };

      try {
        const attempt = await execute(saved.sessionId, prompt);
        if (delivery.signal.aborted) return;
        if (attempt.state.apiKeyRejected)
          throw new Error("Cursor reported a non-login credential source, so the turn was stopped.");

        if ((attempt.code !== 0 || attempt.state.isError || !attempt.state.sawResult) && saved.sessionId) {
          try { await agents.storage.set(sessionKey, JSON.stringify({ cursor: saved.cursor })); } catch { /* next turn may still retry the saved session */ }
        }

        const { code, state } = attempt;
        if (code !== 0 || state.isError || !state.sawResult)
          throw new Error(redact(state.stderr || state.result || `Cursor exited with code ${code}`).trim());
        if (!state.sentBuzzMessage && state.result.trim())
          await agents.harness.reply(delivery.agent, conversation, state.result.trim());
        try {
          if (state.sessionId) await agents.storage.set(sessionKey, JSON.stringify({ sessionId: state.sessionId, cursor: turn.cursor }));
        } catch { /* a successful answer must not become a false failure */ }
      } catch (error) {
        if (!accepted) turn.restore();
        throw new Error(redact(error?.message ?? error));
      } finally {
        if (abort) delivery.signal.removeEventListener("abort", abort);
        if (process) activeProcesses.delete(process);
        await mcp.close();
        try { await captureProcess("cleanup", { input: wrapperKey }); } catch { /* best-effort cleanup after cancel or crash */ }
      }
    },
  });
}

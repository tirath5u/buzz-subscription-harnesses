export const inject = ["react", "agents", "host", "settingsCards"];

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const { agents, host } = ctx;
  const TYPE_ID = "claude-code-subscription";
  const DEFAULT_CONFIG = {
    model: "sonnet",
    permissionMode: "default",
    workspace: "~/.buzz",
    scope: "thread",
    instructions: "",
  };
  const MODELS = [
    {
      "id": "sonnet",
      "label": "Sonnet (latest)"
    },
    {
      "id": "opus",
      "label": "Opus (latest)"
    },
    {
      "id": "fable",
      "label": "Fable (latest)"
    },
    {
      "id": "haiku",
      "label": "Haiku (latest)"
    },
    {
      "id": "claude-fable-5-2",
      "label": "Claude Fable 5.2"
    },
    {
      "id": "claude-opus-5-5",
      "label": "Claude Opus 5.5"
    },
    {
      "id": "claude-sonnet-5-5",
      "label": "Claude Sonnet 5.5"
    },
    {
      "id": "claude-haiku-5-5",
      "label": "Claude Haiku 5.5"
    }
  ];
  const MODEL_IDS = MODELS.map((m) => m.id);
  const activeProcesses = new Set();
  const apiKeyWarned = new Set();

  ctx.effect(() => () => {
    for (const process of activeProcesses) void process.kill();
    activeProcesses.clear();
  });

  function normalized(value) {
    const raw = value && typeof value === "object" ? value : {};
    return {
      model: MODEL_IDS.includes(raw.model) ? raw.model : "sonnet",
      permissionMode: ["default", "acceptEdits", "plan", "bypassPermissions"].includes(raw.permissionMode)
        ? raw.permissionMode
        : "default",
      workspace: typeof raw.workspace === "string" && raw.workspace.trim()
        ? raw.workspace.trim()
        : DEFAULT_CONFIG.workspace,
      scope: raw.scope === "channel" ? "channel" : "thread",
      instructions: typeof raw.instructions === "string" ? raw.instructions : "",
    };
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

  async function diagnose() {
    try {
      const result = await captureProcess("diagnose", {});
      const line = result.stdout.trim().split(/\r?\n/).findLast(Boolean);
      const parsed = line ? JSON.parse(line) : {};
      return {
        found: parsed.found === true,
        path: typeof parsed.path === "string" ? parsed.path : "",
        apiKeySet: parsed.apiKeySet === true,
        error: result.code === 0 ? "" : result.stderr.trim(),
      };
    } catch (error) {
      return { found: false, path: "", apiKeySet: false, error: String(error) };
    }
  }

  function inspectEvent(event, state, delivery) {
    if (!event || typeof event !== "object") return;
    if (typeof event.session_id === "string" && event.session_id.trim())
      state.sessionId = event.session_id.trim();

    if (event.type === "system" && event.subtype === "init") {
      state.sawInit = true;
      if (event.apiKeySource === "none") state.apiKeySourceNone = true;
      else if (typeof event.apiKeySource === "string") state.apiKeyRejected = true;
      return;
    }
    if (event.type === "rate_limit_event") {
      const info = event.rate_limit_info ?? event;
      if (info?.isUsingOverage === false) state.noOverage = true;
      return;
    }
    if (event.type === "assistant") {
      const content = event.message?.content;
      if (!Array.isArray(content)) return;
      for (const item of content) {
        if (item?.type === "tool_use") {
          if (/(^|[_.:/-])(messages?_send|send|reply_in_subthread)$/i.test(String(item.name ?? "")) && item.id)
            (state.pendingSends ??= new Set()).add(item.id);
          const input = item.input && typeof item.input === "object" ? item.input : {};
          const target = input.file_path ?? input.path ?? input.command ?? input.pattern;
          delivery?.step?.(String(item.name ?? "Tool"), target == null ? undefined : String(target).slice(0, 500));
        }
      }
      return;
    }
    if (event.type === "user") {
      const content = event.message?.content;
      if (!Array.isArray(content)) return;
      for (const item of content) {
        if (item?.type === "tool_result" && state.pendingSends?.has(item.tool_use_id)) {
          state.pendingSends.delete(item.tool_use_id);
          if (item.is_error !== true) state.sentBuzzMessage = true;
        }
      }
      return;
    }
    if (event.type === "result") {
      state.sawResult = true;
      state.isError = event.is_error === true;
      state.result = typeof event.result === "string" ? event.result : "";
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
    if (!diagnostic.found) {
      return {
        ok: false,
        text: "Claude CLI was not found. Install it with Anthropic’s official Windows installer, then run `claude` once and choose “Claude account with subscription”.",
      };
    }
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
    const probeArgs = ["-p", "--output-format", "stream-json", "--verbose"];
    const result = await captureProcess("claude", {
      input: JSON.stringify({ args: probeArgs, prompt: "say hi" }),
      env: { ANTHROPIC_API_KEY: null, PYTHONIOENCODING: "utf-8" },
      onProcess(value) { probeProcess = value; },
      onStdout: consume,
    });
    if (buffer.trim()) {
      try { inspectEvent(JSON.parse(buffer), state); } catch { /* ignored */ }
    }
    const subscriptionIndicators = state.apiKeySourceNone && (state.noOverage || state.standardTier);
    const warning = diagnostic.apiKeySet
      ? " Warning: ANTHROPIC_API_KEY is set in your environment and normally overrides subscription login; this plugin removes it from Claude turn/test processes."
      : "";
    if (state.apiKeyRejected) {
      return { ok: false, text: "Claude reported an API-key credential source, so the subscription test was stopped." };
    }
    if (result.code !== 0 || state.isError || !state.sawResult) {
      return { ok: false, text: `Claude started but the test failed: ${(result.stderr || state.result || `exit ${result.code}`).trim()}${warning}` };
    }
    return {
      ok: true,
      text: `${subscriptionIndicators ? "Subscription indicators detected" : "Claude is authenticated, but subscription indicators were inconclusive"} (apiKeySource=${state.apiKeySourceNone ? "none" : "unknown"}, overage=${state.noOverage ? "false" : "unknown"}, service tier=${state.standardTier ? "standard" : "unknown"}).${warning}`,
    };
  }

  function Fields({ config, onChange, disabled = false }) {
    const value = normalized(config);
    const field = (label, control) => h("label", { style: { display: "grid", gap: "var(--space-1)" } }, h("span", null, label), control);
    return h("div", { style: { display: "grid", gap: "var(--space-3)" } },
      field("Model", h("select", { value: value.model, disabled, onChange: (event) => onChange({ ...value, model: event.target.value }) },
        ...MODELS.map((m) => h("option", { key: m.id, value: m.id }, m.label)))),
      field("Permission mode", h("select", { value: value.permissionMode, disabled, onChange: (event) => onChange({ ...value, permissionMode: event.target.value }) },
        h("option", { value: "default" }, "Default"),
        h("option", { value: "acceptEdits" }, "Accept edits"),
        h("option", { value: "plan" }, "Plan only"),
        h("option", { value: "bypassPermissions" }, "Bypass permissions (unsafe)"))),
      field("Working folder", h("input", { value: value.workspace, disabled, spellCheck: false, onChange: (event) => onChange({ ...value, workspace: event.target.value }) })),
      field("Agent instructions", h("textarea", { value: value.instructions, disabled, rows: 6, placeholder: "Describe this agent’s role, responsibilities, and working style.", onChange: (event) => onChange({ ...value, instructions: event.target.value }) })),
      field("Conversation scope", h("select", { value: value.scope, disabled, onChange: (event) => onChange({ ...value, scope: event.target.value }) },
        h("option", { value: "thread" }, "One Claude session per thread"),
        h("option", { value: "channel" }, "One Claude session per channel")))
    );
  }

  function TestPanel() {
    const [status, setStatus] = React.useState({ running: false, text: "" });
    const test = async () => {
      setStatus({ running: true, text: "Running `claude -p \"say hi\"` without ANTHROPIC_API_KEY…" });
      const result = await runProbe();
      setStatus({ running: false, text: result.text, ok: result.ok });
    };
    return h("div", { className: "ui-card", style: { padding: "var(--space-panel-inset)", display: "grid", gap: "var(--space-2)" } },
      h("h3", null, "Subscription test"),
      h("p", null, "Runs the official Claude CLI. It never reads or copies Claude’s stored OAuth credentials."),
      h("button", { type: "button", disabled: status.running, onClick: test }, status.running ? "Testing…" : "Test Claude subscription"),
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
      h("div", null, h("button", { type: "button", disabled: saving, onClick: submit }, saving ? "Saving…" : "Save settings")),
      message ? h("p", { role: "status" }, message) : null,
      h(TestPanel)
    );
  }

  function GlobalSettings() {
    const [diagnostic, setDiagnostic] = React.useState(null);
    React.useEffect(() => { let live = true; void diagnose().then((value) => live && setDiagnostic(value)); return () => { live = false; }; }, []);
    return h("section", { style: { display: "grid", gap: "var(--space-4)" } },
      h("h2", null, "Claude Code (Subscription)"),
      diagnostic === null ? h("p", null, "Checking Claude CLI…")
        : !diagnostic.found ? h("p", { role: "alert" }, "Claude CLI was not found. Install it with Anthropic’s official Windows installer, run `claude` once, and choose “Claude account with subscription”.")
        : h("div", null,
            h("p", null, `Found Claude at ${diagnostic.path}.`),
            diagnostic.apiKeySet ? h("p", { role: "alert" }, "Warning: ANTHROPIC_API_KEY is set and normally overrides your subscription. This plugin removes it from Claude test and turn processes.") : h("p", null, "ANTHROPIC_API_KEY is not set.")),
      h(TestPanel)
    );
  }

  ctx.settingsCards.register({ id: "claude-subscription", title: "Claude Code (Subscription)", group: "Plugins", component: GlobalSettings });

  agents.register({
    id: TYPE_ID,
    title: "Claude Code (Subscription)",
    description: "Official Claude Code CLI using your logged-in Pro/Max subscription on Windows.",
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
    summary: (agent) => `Claude ${normalized(agent.config).model}`,
    CreateConfiguration,
    createModelReportsReadiness: true,
    models: (agent) => ({
      current: normalized(agent.config).model,
      models: MODELS.map((m) => ({ ...m, efforts: [] })),
    }),
    syncedSettings: {
      schema: {
        model: MODEL_IDS,
        permissionMode: ["default", "acceptEdits", "plan", "bypassPermissions"],
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
          "Claude CLI was not found. Install it with Anthropic’s official Windows installer, run `claude` once, and choose **Claude account with subscription**.",
          { notifyOwner: true });
        throw new Error("Claude CLI not found");
      }
      if (diagnostic.apiKeySet && !apiKeyWarned.has(delivery.agent.key)) {
        apiKeyWarned.add(delivery.agent.key);
        await agents.harness.reply(delivery.agent, conversation,
          "⚠️ `ANTHROPIC_API_KEY` is set and normally overrides your subscription. This plugin removes it from Claude turn processes, so this run uses the logged-in Claude CLI account instead.");
      }

      const sessionKey = `community.claude-code-subscription/session/${delivery.agent.key}/${encodeURIComponent(conversation.key)}`;
      let saved = {};
      try { saved = JSON.parse((await agents.storage.read(sessionKey)) ?? "{}"); } catch { /* start a new session */ }
      const system = await agents.harness.systemPrompt(delivery, {
        scope: config.scope,
        cwd: config.workspace,
        instructions: [
          config.instructions.trim(),
          "Use Buzz MCP tools for all conversation messages and attachments. Report file edits with their paths; Buzz shows tool activity live.",
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
      const args = [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--model", delivery.model || config.model,
        "--permission-mode", config.permissionMode,
        "--mcp-config", "__BUZZ_MCP_CONFIG__",
        "--strict-mcp-config",
        "--allowedTools", "mcp__buzz",
        ...(saved.sessionId ? ["--resume", saved.sessionId] : []),
      ];
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
      let process;
      let accepted = false;
      const stop = async () => { if (process) await process.kill(); };
      try {
        process = await host.spawn("claude", {
          cwd: config.workspace,
          env: {
            ANTHROPIC_API_KEY: null,
            PYTHONIOENCODING: "utf-8",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          },
          onStdout: consume,
          onStderr(data) { state.stderr = `${state.stderr ?? ""}${data}`.slice(-16000); },
        });
        activeProcesses.add(process);
        await process.end(JSON.stringify({ args, prompt, mcpConfig }));
        delivery.acknowledged?.();
        accepted = true;
        delivery.interruptible?.(stop);
        const abort = () => void stop();
        delivery.signal.addEventListener("abort", abort, { once: true });
        const code = await process.exited;
        delivery.signal.removeEventListener("abort", abort);
        activeProcesses.delete(process);
        if (buffer.trim()) { try { inspectEvent(JSON.parse(buffer), state, delivery); } catch { /* ignored */ } }
        if (delivery.signal.aborted) return;
        if (state.apiKeyRejected)
          throw new Error("Claude reported an API-key credential source, so the turn was stopped.");
        if (code !== 0 || state.isError || !state.sawResult)
          throw new Error((state.stderr || state.result || `Claude exited with code ${code}`).trim());
        if (!state.sentBuzzMessage && state.result.trim())
          await agents.harness.reply(delivery.agent, conversation, state.result.trim());
        try {
          if (state.sessionId) await agents.storage.set(sessionKey, JSON.stringify({ sessionId: state.sessionId, cursor: turn.cursor }));
        } catch { /* a successful answer must not become a false failure */ }
      } catch (error) {
        if (!accepted) turn.restore();
        throw error;
      } finally {
        if (process) activeProcesses.delete(process);
        await mcp.close();
      }
    },
  });
}

export const inject = ["react", "agents", "host", "settingsCards"];

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const { agents, host } = ctx;
  const TYPE_ID = "gemini-cli-subscription";
  const DEFAULT_CONFIG = { model: "default", approvalMode: "plan", workspace: "~/.buzz", scope: "thread", instructions: "" };
  const MODELS = [
    {
      "id": "default",
      "label": "CLI default"
    },
    {
      "id": "gemini-3.8-flash-high",
      "label": "Gemini 3.8 Flash (High)"
    },
    {
      "id": "gemini-3.8-flash-medium",
      "label": "Gemini 3.8 Flash (Medium)"
    },
    {
      "id": "gemini-3.8-flash-low",
      "label": "Gemini 3.8 Flash (Low)"
    },
    {
      "id": "claude-sonnet-4-6",
      "label": "Claude Sonnet 4.6 (Thinking)"
    },
    {
      "id": "claude-opus-4-6-thinking",
      "label": "Claude Opus 4.6 (Thinking)"
    },
    {
      "id": "gpt-oss-120b-medium",
      "label": "GPT-OSS 120B (Medium)"
    }
  ];
  const MODEL_IDS = MODELS.map((m) => m.id);
  const activeProcesses = new Set();
  const keyWarned = new Set();

  ctx.effect(() => () => {
    for (const process of activeProcesses) void process.kill();
    activeProcesses.clear();
  });

  function normalized(value) {
    const raw = value && typeof value === "object" ? value : {};
    return {
      model: MODEL_IDS.includes(raw.model) ? raw.model : "default",
      approvalMode: ["plan", "accept-edits", "auto"].includes(raw.approvalMode) ? raw.approvalMode : "plan",
      workspace: typeof raw.workspace === "string" && raw.workspace.trim() ? raw.workspace.trim() : DEFAULT_CONFIG.workspace,
      scope: raw.scope === "channel" ? "channel" : "thread",
      instructions: typeof raw.instructions === "string" ? raw.instructions : "",
    };
  }

  function redact(text) {
    return String(text ?? "")
      .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
      .replace(/((?:GEMINI|GOOGLE)_API_KEY\s*[:=]\s*)[^\s"']+/gi, "$1[REDACTED]");
  }

  async function captureProcess(id, options = {}) {
    if (!host.spawn) throw new Error("Process launching is unavailable. Use the Buzz desktop app.");
    let stdout = "";
    let stderr = "";
    const { input, onProcess, ...spawnOptions } = options;
    const process = await host.spawn(id, {
      ...spawnOptions,
      onStdout(data) { stdout += data; options.onStdout?.(data); },
      onStderr(data) { stderr += data; options.onStderr?.(data); },
    });
    activeProcesses.add(process);
    onProcess?.(process);
    if (input !== undefined) await process.end(input);
    const code = await process.exited.finally(() => activeProcesses.delete(process));
    return { code, stdout, stderr };
  }

  async function diagnose() {
    try {
      const result = await captureProcess("diagnose");
      const line = result.stdout.trim().split(/\r?\n/).findLast(Boolean);
      const parsed = line ? JSON.parse(line) : {};
      return { found: parsed.found === true, path: typeof parsed.path === "string" ? parsed.path : "", geminiApiKeySet: parsed.geminiApiKeySet === true, googleApiKeySet: parsed.googleApiKeySet === true, error: result.code === 0 ? "" : redact(result.stderr) };
    } catch (error) {
      return { found: false, path: "", geminiApiKeySet: false, googleApiKeySet: false, error: redact(error) };
    }
  }

  function isBuzzMessageSend(step) {
    if (!step) return false;
    const toolName = String(step.tool_name ?? step.tool_info?.name ?? step.step_type ?? "").trim();
    if (/(^|__)(messages?_send|send|reply_in_subthread)$/i.test(toolName) || /^buzz_(send|reply_in_subthread)$/i.test(toolName)) {
      return true;
    }
    const params = step.tool_info?.parameters ?? step.parameters ?? step.args;
    if (params && typeof params === "object") {
      const subTool = String(params.ToolName ?? params.tool ?? params.tool_name ?? "").replace(/^["']|["']$/g, "").trim();
      if (/^(messages?_send|send|reply_in_subthread)$/i.test(subTool)) {
        return true;
      }
    }
    return false;
  }

  function inspectEvent(event, state, delivery) {
    if (!event || typeof event !== "object") return;
    const conversationId = event.conversation_id ?? event.init?.conversation_id ?? event.result?.conversation_id ?? event.step_update?.conversation_id;
    if (typeof conversationId === "string" && conversationId.trim()) state.sessionId = conversationId.trim();
    if (event.event === "init") state.sawInit = true;
    if (event.event === "step_update") {
      const step = event.step_update ?? {};
      if (step.step_type === "agent_response" && typeof step.text_delta === "string") state.result = `${state.result ?? ""}${step.text_delta}`;
      if (step.step_type && step.step_type !== "agent_response" && step.step_type !== "user_input") {
        let name = String(step.tool_name ?? step.step_type);
        if (isBuzzMessageSend(step)) state.sentBuzzMessage = true;
        const params = step.tool_info?.parameters ?? step.parameters ?? step.args;
        if (name === "call_mcp_tool" && params && typeof params === "object") {
          const subTool = String(params.ToolName ?? params.tool ?? "").replace(/^["']|["']$/g, "").trim();
          if (subTool) name = subTool;
        }
        const detail = String(step.path ?? step.command ?? params?.CommandLine ?? params?.Path ?? params?.path ?? "").slice(0, 500) || undefined;
        delivery?.step?.(name, detail);
      }
    }
    if (event.event === "result") {
      const result = event.result ?? {};
      state.sawResult = true;
      state.isError = String(result.status ?? "").toUpperCase() !== "SUCCESS";
      if (typeof result.response === "string" && result.response.trim()) state.result = result.response;
      if (result.error) state.error = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
    }
  }

  async function runProbe() {
    const diagnostic = await diagnose();
    if (!diagnostic.found) return { ok: false, text: "Antigravity CLI was not found. Install Google Antigravity and run `agy install`, then sign in." };
    const state = {};
    let buffer = "";
    const consume = (data) => {
      buffer += data;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) { try { inspectEvent(JSON.parse(line), state); } catch { /* diagnostics */ } }
    };
    const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--mode", "plan", "--print-timeout", "90s", "--print="];
    const input = `${JSON.stringify({ event: "user", message: { content: "Reply with exactly ANTIGRAVITY_SUBSCRIPTION_OK" } })}\n`;
    const result = await captureProcess("antigravity", {
      input: JSON.stringify({ args, input, mcpConfig: "{\"mcpServers\":{}}", wrapperKey: "subscription-probe" }),
      env: { GEMINI_API_KEY: null, GOOGLE_API_KEY: null, PYTHONIOENCODING: "utf-8" },
      onStdout: consume,
    });
    if (buffer.trim()) { try { inspectEvent(JSON.parse(buffer), state); } catch { /* ignored */ } }
    const warning = diagnostic.geminiApiKeySet || diagnostic.googleApiKeySet ? " Warning: an API-key environment variable is set; this plugin removes GEMINI_API_KEY and GOOGLE_API_KEY from every test and turn." : "";
    if (result.code !== 0 || state.isError || !String(state.result ?? "").includes("ANTIGRAVITY_SUBSCRIPTION_OK")) {
      return { ok: false, text: `Antigravity started but the signed-in account test failed: ${redact(result.stderr || state.error || state.result || `exit ${result.code}`).trim()}${warning}` };
    }
    return { ok: true, text: `Antigravity CLI completed a headless stream-json turn using its signed-in account.${warning}` };
  }

  function Fields({ config, onChange, disabled = false }) {
    const value = normalized(config);
    const field = (label, control) => h("label", { style: { display: "grid", gap: "var(--space-1)" } }, h("span", null, label), control);
    return h("div", { style: { display: "grid", gap: "var(--space-3)" } },
      field("Model", h("select", { value: value.model, disabled, onChange: (e) => onChange({ ...value, model: e.target.value }) }, ...MODELS.map((m) => h("option", { key: m.id, value: m.id }, m.label)))),
      field("Approval mode", h("select", { value: value.approvalMode, disabled, onChange: (e) => onChange({ ...value, approvalMode: e.target.value }) }, h("option", { value: "plan" }, "Plan only"), h("option", { value: "accept-edits" }, "Accept edits"), h("option", { value: "auto" }, "Automatic"))),
      field("Working folder", h("input", { value: value.workspace, disabled, spellCheck: false, onChange: (e) => onChange({ ...value, workspace: e.target.value }) })),
      field("Agent instructions", h("textarea", { value: value.instructions, disabled, rows: 6, onChange: (e) => onChange({ ...value, instructions: e.target.value }) })),
      field("Conversation scope", h("select", { value: value.scope, disabled, onChange: (e) => onChange({ ...value, scope: e.target.value }) }, h("option", { value: "thread" }, "One Antigravity conversation per thread"), h("option", { value: "channel" }, "One Antigravity conversation per channel")))
    );
  }

  function TestPanel() {
    const [status, setStatus] = React.useState({ running: false, text: "" });
    const test = async () => { setStatus({ running: true, text: "Running Antigravity without API-key variables…" }); const result = await runProbe(); setStatus({ running: false, ...result }); };
    return h("div", { className: "ui-card", style: { padding: "var(--space-panel-inset)", display: "grid", gap: "var(--space-2)" } }, h("h3", null, "Subscription test"), h("p", null, "Runs the official Antigravity CLI. It never reads or copies stored Google credentials."), h("button", { type: "button", disabled: status.running, onClick: test }, status.running ? "Testing…" : "Test Antigravity subscription"), status.text ? h("p", { role: "status" }, status.text) : null);
  }

  function CreateConfiguration({ config, onChange, disabled, harnessControl, onReadyChange }) {
    React.useEffect(() => { onReadyChange?.(true); }, [onReadyChange]);
    return h("div", { style: { display: "grid", gap: "var(--space-3)" } }, harnessControl, h(Fields, { config, onChange, disabled }));
  }

  function SettingsTab({ agent, save, settingsContent }) {
    const [draft, setDraft] = React.useState(() => normalized(agent.config));
    const [message, setMessage] = React.useState("");
    React.useEffect(() => setDraft(normalized(agent.config)), [agent.config]);
    const submit = async () => { try { await save(draft); setMessage("Saved."); } catch (error) { setMessage(redact(error)); } };
    return h("section", { style: { display: "grid", gap: "var(--space-4)", padding: "var(--space-panel-inset)" } }, settingsContent, h(Fields, { config: draft, onChange: setDraft }), h("div", null, h("button", { type: "button", onClick: submit }, "Save settings")), message ? h("p", { role: "status" }, message) : null, h(TestPanel));
  }

  function GlobalSettings() {
    const [diagnostic, setDiagnostic] = React.useState(null);
    React.useEffect(() => { let live = true; void diagnose().then((value) => live && setDiagnostic(value)); return () => { live = false; }; }, []);
    const keys = diagnostic && (diagnostic.geminiApiKeySet || diagnostic.googleApiKeySet);
    return h("section", { style: { display: "grid", gap: "var(--space-4)" } }, h("h2", null, "Google Antigravity (Subscription)"), diagnostic === null ? h("p", null, "Checking Antigravity CLI…") : !diagnostic.found ? h("p", { role: "alert" }, "Antigravity CLI was not found.") : h("div", null, h("p", null, `Found Antigravity at ${diagnostic.path}.`), keys ? h("p", { role: "alert" }, "Warning: GEMINI_API_KEY or GOOGLE_API_KEY is set. This plugin removes both from Antigravity processes.") : h("p", null, "No Google API-key environment variable is set.")), h(TestPanel));
  }

  ctx.settingsCards.register({ id: "antigravity-subscription", title: "Google Antigravity (Subscription)", group: "Plugins", component: GlobalSettings });

  agents.register({
    id: TYPE_ID,
    title: "Google Antigravity (Subscription)",
    description: "Official Google Antigravity CLI using your signed-in account on Windows.",
    defaults: () => ({ config: DEFAULT_CONFIG }),
    carry: (saved) => { const value = normalized(saved); return { ...(value.instructions.trim() ? { instructions: value.instructions } : {}), ...(value.workspace !== DEFAULT_CONFIG.workspace ? { workspace: value.workspace } : {}) }; },
    adopt: (carry, saved) => ({ ...normalized(saved), instructions: carry.instructions ?? normalized(saved).instructions, workspace: carry.workspace ?? normalized(saved).workspace }),
    summary: (agent) => normalized(agent.config).model === "default" ? "Antigravity default" : normalized(agent.config).model,
    CreateConfiguration,
    createModelReportsReadiness: true,
    models: (agent) => ({ current: normalized(agent.config).model, models: MODELS.map((m) => ({ ...m, efforts: [] })) }),
    syncedSettings: { schema: { model: MODEL_IDS, approvalMode: ["plan", "accept-edits", "auto"], workspace: "string", scope: ["thread", "channel"] }, withSynced(saved, settings) { return normalized({ ...normalized(saved), ...settings }); } },
    tabs: [{ id: "settings", title: "Settings", role: "settings", component: SettingsTab }],
    timeoutMs: 30 * 60 * 1000,
    resumes: true,
    async run(delivery) {
      const config = normalized(delivery.config);
      const conversation = await agents.harness.conversation(delivery, config.scope);
      if (!conversation) { delivery.ignored?.(); return; }
      const diagnostic = await diagnose();
      if (!diagnostic.found) { await agents.harness.reply(delivery.agent, conversation, "Antigravity CLI was not found. Open Antigravity, run `agy install`, and sign in.", { notifyOwner: true }); throw new Error("Antigravity CLI not found"); }
      if ((diagnostic.geminiApiKeySet || diagnostic.googleApiKeySet) && !keyWarned.has(delivery.agent.key)) {
        keyWarned.add(delivery.agent.key);
        await agents.harness.reply(delivery.agent, conversation, "⚠️ `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set. This plugin removes both variables from Antigravity turn processes so the signed-in account is used.");
      }
      const sessionKey = `community.antigravity-subscription/session/${delivery.agent.key}/${encodeURIComponent(conversation.key)}`;
      let saved = {};
      try { saved = JSON.parse((await agents.storage.read(sessionKey)) ?? "{}"); } catch { /* new session */ }
      const system = await agents.harness.systemPrompt(delivery, { scope: config.scope, cwd: config.workspace, instructions: [config.instructions.trim(), "Use Buzz MCP tools for conversation messages and attachments. Report file edits with their paths."].filter(Boolean).join("\n\n"), tools: true });
      const turn = await agents.harness.turnPrompt(delivery, conversation, { cursor: saved.cursor });
      const prompt = saved.sessionId ? turn.text : `${system}\n\n${turn.text}`;
      const mcp = await host.serveMcp(agents.harness.tools(delivery.agent, conversation, { read: (path) => host.readFile(path, { cwd: config.workspace }) }));
      const mcpConfig = JSON.stringify({ mcpServers: { buzz: { serverUrl: mcp.url, headers: Object.fromEntries(mcp.headers.map(({ name, value }) => [name, value])) } } });
      const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--mode", config.approvalMode, "--print-timeout", "0", "--add-dir", config.workspace, ...((delivery.model || config.model) === "default" ? [] : ["--model", delivery.model || config.model]), ...(saved.sessionId ? ["--conversation", saved.sessionId] : []), "--print="];
      const input = `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`;
      const wrapperKey = `${delivery.agent.key}-${conversation.key}`;
      const state = { sessionId: saved.sessionId };
      let buffer = "";
      let process;
      let accepted = false;
      const consume = (data) => { buffer += data; const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ""; for (const line of lines) { try { inspectEvent(JSON.parse(line), state, delivery); } catch { /* diagnostics */ } } };
      const stop = async () => { if (process) await process.kill(); };
      try {
        process = await host.spawn("antigravity", { cwd: config.workspace, env: { GEMINI_API_KEY: null, GOOGLE_API_KEY: null, PYTHONIOENCODING: "utf-8" }, onStdout: consume, onStderr(data) { state.stderr = `${state.stderr ?? ""}${data}`.slice(-16000); } });
        activeProcesses.add(process);
        await process.end(JSON.stringify({ args, input, mcpConfig, wrapperKey }));
        delivery.acknowledged?.(); accepted = true; delivery.interruptible?.(stop);
        const abort = () => void stop(); delivery.signal.addEventListener("abort", abort, { once: true });
        const code = await process.exited; delivery.signal.removeEventListener("abort", abort); activeProcesses.delete(process);
        if (buffer.trim()) { try { inspectEvent(JSON.parse(buffer), state, delivery); } catch { /* ignored */ } }
        if (delivery.signal.aborted) return;
        if (code !== 0 || state.isError || !state.sawResult) throw new Error(redact(state.stderr || state.error || `Antigravity exited with code ${code}`).trim());
        try { await agents.storage.set(sessionKey, JSON.stringify({ sessionId: state.sessionId, cursor: turn.cursor })); } catch { /* a successful answer must not become a false failure */ }
        if (!state.sentBuzzMessage && String(state.result ?? "").trim()) await agents.harness.reply(delivery.agent, conversation, String(state.result).trim());
        else if (!state.sentBuzzMessage) throw new Error("Antigravity completed without returning a final message.");
      } catch (error) { if (!accepted) turn.restore(); throw error; }
      finally { if (process) activeProcesses.delete(process); await mcp.close(); }
    },
  });
}

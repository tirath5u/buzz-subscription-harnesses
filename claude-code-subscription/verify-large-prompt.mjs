import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const launcher = manifest.host.processes.find((entry) => entry.id === "claude");
assert(launcher, "claude process declaration missing");
const dir = mkdtempSync(join(tmpdir(), "buzz-claude-launcher-"));
try {
  writeFileSync(join(dir, "claude.cmd"), "@echo off\r\nnode \"%~dp0capture.mjs\" %*\r\n");
  writeFileSync(join(dir, "capture.mjs"), `import { readFileSync } from "node:fs"; let text=""; process.stdin.setEncoding("utf8"); process.stdin.on("data",x=>text+=x); process.stdin.on("end",()=>{const args=process.argv.slice(2); const i=args.indexOf("--mcp-config"); const mcpPath=i>=0?args[i+1]:""; console.log(JSON.stringify({text,args,mcpPath,mcpConfig:mcpPath?readFileSync(mcpPath,"utf8"):""}))});`);
  const body = `🐝 spaces \"quotes\" ; $() & %PATH% !PATH!\n`.repeat(2400);
  const prompt = `BEGIN-LARGE-PROMPT\n${body}END-LARGE-PROMPT`;
  assert(Buffer.byteLength(prompt, "utf8") > 32768);
  const mcpConfig = JSON.stringify({ mcpServers: { buzz: { type: "http", url: "http://127.0.0.1:62060/mcp", headers: { Authorization: "Bearer test-token" } } } });
  const expectedArgs = ["-p", "--output-format", "stream-json", "--verbose", "--mcp-config", "__BUZZ_MCP_CONFIG__", "--strict-mcp-config"];
  const result = spawnSync(launcher.program, launcher.args, {
    input: JSON.stringify({ args: expectedArgs, prompt, mcpConfig }),
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` },
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || "launcher failed");
  const captured = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert(captured.text.startsWith("BEGIN-LARGE-PROMPT\n"));
  assert(captured.text.includes("END-LARGE-PROMPT"));
  assert(captured.text.length >= prompt.length, "large prompt was truncated");
  assert.equal(captured.mcpConfig, mcpConfig, "temporary MCP config did not preserve JSON");
  assert.notEqual(captured.mcpPath, "__BUZZ_MCP_CONFIG__", "MCP placeholder was not replaced");
  assert.deepEqual(captured.args.slice(0, -2), expectedArgs.slice(0, -2));
  assert.deepEqual(captured.args.slice(-2), [captured.mcpPath, "--strict-mcp-config"]);
  console.log(`launcher verified: ${Buffer.byteLength(prompt, "utf8")} UTF-8 prompt bytes and MCP config reached claude.cmd safely`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

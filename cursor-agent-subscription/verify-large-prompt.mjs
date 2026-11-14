import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const launcher = manifest.host.processes.find((entry) => entry.id === "cursor");
assert(launcher, "cursor process declaration missing");
const dir = mkdtempSync(join(tmpdir(), "buzz-cursor-launcher-"));
try {
  writeFileSync(join(dir, "cursor-agent.cmd"), "@echo off\r\nnode \"%~dp0capture.mjs\" %*\r\n");
  writeFileSync(join(dir, "capture.mjs"), `import fs from "node:fs"; const args=process.argv.slice(2); const text=fs.readFileSync(0,"utf8").trimEnd(); console.log(JSON.stringify({text,args}));`);
  const body = `🐝 spaces "quotes" ; $() & %PATH% !PATH!\n`.repeat(2400);
  const prompt = `BEGIN-LARGE-PROMPT\n${body}END-LARGE-PROMPT`;
  assert(Buffer.byteLength(prompt, "utf8") > 32768);
  const result = spawnSync(launcher.program, launcher.args, {
    input: JSON.stringify({ args: ["-p", "--output-format", "stream-json", "--plugin-dir", "__BUZZ_PLUGIN_DIR__"], prompt, mcpConfig: '{"mcpServers":{}}', wrapperKey: "verify-large" }),
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` },
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || "launcher failed");
  const captured = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(captured.text, prompt, "large prompt was changed or truncated");
  assert(captured.args.includes("-p"));
  assert(!captured.args.includes("__BUZZ_PLUGIN_DIR__"), "plugin directory placeholder was not replaced");
  console.log(`large prompt verified: ${Buffer.byteLength(prompt, "utf8")} UTF-8 bytes reached Cursor through stdin`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

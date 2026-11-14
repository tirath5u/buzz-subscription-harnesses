import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const launcher = manifest.host.processes.find((entry) => entry.id === "cursor");
assert(launcher, "cursor process declaration missing");
const marker = resolve(".cursor-launcher-injection-marker");
rmSync(marker, { force: true });
const hostile = `spaces "quotes"; $(Set-Content -LiteralPath '${marker}' -Value pwned) 🐝`;
const result = spawnSync(launcher.program, launcher.args, {
  input: JSON.stringify({ args: ["--version"], prompt: hostile, mcpConfig: '{"mcpServers":{}}', wrapperKey: "verify-hostile" }),
  encoding: "utf8",
});
assert(!existsSync(marker), "prompt text was interpreted by PowerShell");
assert.equal(result.status, 0, result.stderr || "launcher did not run Cursor Agent");
assert.match(result.stdout, /\d{4}\.\d+\.\d+/, "launcher did not return Cursor Agent version");

const cleanup = manifest.host.processes.find((entry) => entry.id === "cleanup");
assert(cleanup, "cleanup process declaration missing");
const cleanupKey = "verify-cleanup";
const stale = join(tmpdir(), `buzz-cursor-${cleanupKey}`);
mkdirSync(stale, { recursive: true });
writeFileSync(join(stale, "prompt.md"), "sensitive prompt");
writeFileSync(join(stale, "mcp.json"), "sensitive token");
const cleaned = spawnSync(cleanup.program, cleanup.args, { input: cleanupKey, encoding: "utf8" });
assert.equal(cleaned.status, 0, cleaned.stderr || "cleanup process failed");
assert(!existsSync(stale), "cleanup process left turn files in TEMP");
console.log("launcher verified: hostile prompt stayed data; official Cursor Agent started; stale turn files were removed");

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const launcher = manifest.host.processes.find((entry) => entry.id === "claude");
assert(launcher, "claude process declaration missing");

const marker = resolve(".launcher-injection-marker");
rmSync(marker, { force: true });
const hostile = `spaces "quotes"; $(Set-Content -LiteralPath '${marker}' -Value pwned) 🐝`;
const result = spawnSync(launcher.program, launcher.args, {
  input: JSON.stringify({ args: ["--version"], prompt: hostile }),
  encoding: "utf8",
});
assert(!existsSync(marker), "prompt text was interpreted by PowerShell");
assert.equal(result.status, 0, result.stderr || "launcher did not run Claude");
assert.match(result.stdout, /Claude Code/i, "launcher did not return Claude's version");
console.log("launcher verified: JSON stdin preserved hostile text as data; Claude CLI started");

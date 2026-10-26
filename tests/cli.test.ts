import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = join(__dirname, "..", "dist", "cli.js");
const env = { ...process.env, SHUSH_NO_STATS: "", SHUSH_HOME: mkdtempSync(join(tmpdir(), "shush-home-")), SHUSH_LOG_DIR: mkdtempSync(join(tmpdir(), "shush-logs-")) };
const run = (args: string[], input?: string) => spawnSync(process.execPath, [CLI, ...args], { env, input, encoding: "utf8" });

describe("cli (built)", () => {
  it("keeps the exit code of the wrapped command", () => {
    const r = run(["node", "-e", "console.log('boom'); process.exit(3)"]);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain("boom");
    expect(r.stdout).toContain("[shush] exit 3");
  });
  it("runs a single argument through the shell", () => {
    const r = run(["echo one && echo two"]);
    expect(r.stdout.startsWith("one\ntwo\n")).toBe(true);
  });
  it("compresses piped input and saves the full output", () => {
    const input = Array.from({ length: 30 }, (_, i) => `=== RUN   TestX/case_${i}\n    --- PASS: TestX/case_${i} (0.00s)`).join("\n") + "\nok  \texample.com/x\t0.01s\n";
    const r = run(["--cmd", "go test -v"], input);
    expect(r.stdout).toContain("ok  \texample.com/x");
    const id = /shush show (\S+)/.exec(r.stdout)?.[1];
    expect(id).toBeTruthy();
    const full = run(["show", id!, "--grep", "case_29"]);
    expect(full.stdout).toContain("TestX/case_29");
  });
  it("records savings for `shush gain`", () => {
    const r = run(["gain"]);
    expect(r.stdout).toMatch(/runs · .* tokens · saved/);
  });
  it("prints version", () => {
    expect(execFileSync(process.execPath, [CLI, "--version"], { encoding: "utf8" }).trim()).toBe("0.1.0");
  });
});

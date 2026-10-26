import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI = join(__dirname, "..", "dist", "cli.js");
let client: Client;
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);

beforeAll(async () => {
  client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "mcp"],
    env: { ...process.env, SHUSH_NO_STATS: "", SHUSH_HOME: mkdtempSync(join(tmpdir(), "shush-home-")), SHUSH_LOG_DIR: mkdtempSync(join(tmpdir(), "shush-logs-")) } as Record<string, string>,
    stderr: "ignore",
  }));
});
afterAll(async () => { await client.close(); });

describe("mcp server (built, over stdio)", () => {
  it("lists the tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["compress", "gain", "read_full", "run"]);
  });
  it("run: returns compact output and the exit code", async () => {
    const script = "for (let i = 0; i < 40; i++) console.log(' ✓ test ' + i); console.error('FAIL one test'); process.exit(1)";
    const r = await client.callTool({ name: "run", arguments: { command: `node -e "${script}"` } });
    const t = textOf(r);
    expect(r.isError).toBe(true);
    expect(t).toContain("FAIL one test");
    expect(t).not.toContain("✓ test 7");
    expect(t).toMatch(/\[shush\] exit 1 .* hidden: 40 passing test lines/);
  });
  it("read_full: pages through what was hidden", async () => {
    const r = await client.callTool({ name: "compress", arguments: { text: Array.from({ length: 30 }, (_, i) => ` ✓ case ${i}`).join("\n") + "\nall good" } });
    const id = /shush show (\S+)/.exec(textOf(r))![1];
    const full = await client.callTool({ name: "read_full", arguments: { id, grep: "case 17" } });
    expect(textOf(full)).toContain("✓ case 17");
    expect(textOf(full)).toContain("of 1 matching");
  });
  it("read_full: rejects path tricks", async () => {
    const r = await client.callTool({ name: "read_full", arguments: { id: "../../etc/passwd" } });
    expect(r.isError).toBe(true);
  });
});

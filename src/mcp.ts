import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCommand } from "./run.js";
import { shush } from "./shush.js";
import { pageFull, readLedger, summarizeLedger } from "./store.js";
import { VERSION } from "./version.js";

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "shush", version: VERSION },
    {
      instructions:
        "Use the `run` tool instead of a plain shell for commands with long output (tests, builds, installs, git log/diff/status, linters). " +
        "It returns the same result with the noise removed. If you need something that was hidden, call `read_full` with the id from the footer.",
    },
  );

  server.registerTool("run", {
    title: "Run a shell command (compact output)",
    description:
      "Run a shell command and return its output with noise removed (passing tests, progress bars, download logs, git hints, repeated lines), " +
      "keeping every error, warning, failure and summary line. The exit code is always reported. When anything is hidden, the full output is saved " +
      "and its id is printed in the footer so you can page through it with read_full.",
    inputSchema: {
      command: z.string().describe("Shell command, e.g. \"npm test\" or \"git log -20\""),
      cwd: z.string().optional().describe("Working directory (default: the server's working directory)"),
      timeout_sec: z.number().min(1).max(3600).optional().describe("Kill the command after this many seconds (default 600)"),
      max_lines: z.number().int().min(20).max(5000).optional().describe("Max lines to return (default 150; 600 for diffs)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async ({ command, cwd, timeout_sec, max_lines }) => {
    try {
      const r = await runCommand(command, { cwd, timeoutMs: (timeout_sec ?? 600) * 1000 });
      const s = shush(r.output, { command, exitCode: r.exitCode, maxLines: max_lines });
      const notes = [r.timedOut ? `[shush] command timed out after ${timeout_sec ?? 600}s and was killed` : "", r.truncated ? "[shush] output exceeded 64 MB; the rest was discarded" : ""].filter(Boolean);
      return text([s.text, ...notes, s.footer].filter(Boolean).join("\n"), r.exitCode !== 0);
    } catch (err) {
      return text(`Failed to start command: ${(err as Error).message}`, true);
    }
  });

  server.registerTool("compress", {
    title: "Compress text you already have",
    description: "Compress command output or a log that is already in hand (for example pasted by the user). Same rules as run.",
    inputSchema: {
      text: z.string().describe("The raw output"),
      command: z.string().optional().describe("The command that produced it, helps pick the right rules"),
      max_lines: z.number().int().min(20).max(5000).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ text: raw, command, max_lines }) => {
    const s = shush(raw, { command, maxLines: max_lines });
    return text([s.text, s.footer].filter(Boolean).join("\n"));
  });

  server.registerTool("read_full", {
    title: "Read the full, uncompressed output",
    description: "Page through the full output saved by run/compress. Use the id from the footer. Optionally filter lines with a regex.",
    inputSchema: {
      id: z.string().describe("Output id, e.g. 20261026-141503-a1b2c3"),
      start: z.number().int().min(1).optional().describe("First line to return (1-based, default 1)"),
      lines: z.number().int().min(1).max(2000).optional().describe("How many lines (default 200)"),
      grep: z.string().optional().describe("Only lines matching this case-insensitive regex"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ id, start, lines, grep }) => {
    try {
      const p = pageFull(id, { start, lines, grep });
      return text(`${p.text}\n[shush] lines ${p.start}-${p.end} of ${p.total}${grep ? ` matching /${grep}/i` : ""}`);
    } catch (err) {
      return text((err as Error).message, true);
    }
  });

  server.registerTool("gain", {
    title: "Token savings so far",
    description: "Show how many tokens shush has saved on this machine.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => {
    const s = summarizeLedger(readLedger());
    return text(JSON.stringify({ runs: s.runs, tokens_before: s.before, tokens_after: s.after, tokens_saved: s.saved, saved_pct: s.pct, top_commands: s.top.map(([k, v]) => ({ command: k, ...v })) }, null, 2));
  });

  return server;
}

export async function startMcp(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

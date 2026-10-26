#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runCommand } from "./run.js";
import { shush } from "./shush.js";
import { pageFull, readLedger, summarizeLedger } from "./store.js";
import { VERSION } from "./version.js";

const HELP = `shush ${VERSION} - make command output short enough for AI agents

Usage
  shush <command> [args...]       run a command, print compact output, keep its exit code
  shush "cmd1 && cmd2 | cmd3"     a single quoted argument runs through your shell
  <command> 2>&1 | shush [--cmd "npm test"]   compress piped output
  shush show <id> [--grep RE] [--start N] [--lines N]   read the full saved output
  shush gain                      tokens saved so far
  shush mcp                       start the MCP server (stdio)

Options
  --max-lines N    cap compact output at N lines (default 150, 600 for diffs)
  --raw            run the command without compressing (still strips nothing)
  -h, --help       this help
  -v, --version    version

Full outputs are saved in $SHUSH_LOG_DIR (default: <tmp>/shush); stats in ~/.shush.
Set SHUSH_NO_STATS=1 to disable the local savings ledger.`;

function takeOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  if (args[0] === "-h" || args[0] === "--help" || args[0] === "help") { console.log(HELP); return 0; }
  if (args[0] === "-v" || args[0] === "--version") { console.log(VERSION); return 0; }

  if (args[0] === "mcp") {
    const { startMcp } = await import("./mcp.js");
    await startMcp();
    return -1; // keep running
  }

  if (args[0] === "gain") {
    const s = summarizeLedger(readLedger());
    if (!s.runs) { console.log("No runs recorded yet."); return 0; }
    console.log(`${s.runs} runs · ${s.before.toLocaleString("en-US")} → ${s.after.toLocaleString("en-US")} tokens · saved ${s.saved.toLocaleString("en-US")} (${s.pct}%)`);
    for (const [k, v] of s.top) console.log(`  ${k.padEnd(24)} ${String(v.runs).padStart(4)} runs  saved ${(v.before - v.after).toLocaleString("en-US")}`);
    return 0;
  }

  if (args[0] === "show") {
    const id = args[1];
    if (!id) { console.error("usage: shush show <id>"); return 2; }
    const rest = args.slice(2);
    const grep = takeOpt(rest, "--grep");
    const start = takeOpt(rest, "--start");
    const lines = takeOpt(rest, "--lines");
    const p = pageFull(id, { grep, start: start ? Number(start) : undefined, lines: lines ? Number(lines) : 100000 });
    console.log(p.text);
    return 0;
  }

  const maxLines = takeOpt(args, "--max-lines");
  const cmdHint = takeOpt(args, "--cmd");
  const raw = args.includes("--raw");
  if (raw) args.splice(args.indexOf("--raw"), 1);
  if (args[0] === "--") args.shift();
  const max = maxLines ? Number(maxLines) : undefined;

  if (args.length === 0) {
    if (process.stdin.isTTY) { console.log(HELP); return 0; }
    const input = readFileSync(0, "utf8");
    const s = shush(input, { command: cmdHint, maxLines: max });
    process.stdout.write(s.text + (s.text ? "\n" : "") + s.footer + "\n");
    return 0;
  }

  const command = args.length === 1 ? args[0] : args;
  const display = args.join(" ");
  const r = await runCommand(command, {});
  if (raw) { process.stdout.write(r.output); return r.exitCode ?? 1; }
  const s = shush(r.output, { command: display, exitCode: r.exitCode, maxLines: max });
  process.stdout.write(s.text + (s.text ? "\n" : "") + s.footer + "\n");
  return r.exitCode ?? (r.signal ? 128 : 1);
}

main(process.argv.slice(2)).then(
  (code) => { if (code >= 0) process.exitCode = code; },
  (err) => { console.error(`shush: ${(err as Error).message}`); process.exitCode = 127; },
);

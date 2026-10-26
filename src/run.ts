import { spawn } from "node:child_process";

export interface RunResult { output: string; exitCode: number | null; signal: string | null; timedOut: boolean; truncated: boolean }

const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Run a command and capture stdout+stderr interleaved in arrival order.
 * - A single string is run through the shell (pipes, &&, globs work).
 * - An argv array is executed directly, without a shell.
 * Colors are disabled so tools print plain text.
 */
export function runCommand(cmd: string | string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CLICOLOR: "0", TERM: process.env.TERM ?? "dumb" };
    const child = Array.isArray(cmd)
      ? spawn(cmd[0], cmd.slice(1), { cwd: opts.cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
      : spawn(cmd, { cwd: opts.cwd, env, shell: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    const onData = (b: Buffer) => {
      if (bytes + b.length > MAX_BYTES) { truncated = true; return; }
      bytes += b.length;
      chunks.push(b);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    let timedOut = false;
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 2000).unref(); }, opts.timeoutMs) : undefined;
    child.on("error", (err) => { if (timer) clearTimeout(timer); reject(err); });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ output: Buffer.concat(chunks).toString("utf8"), exitCode: code, signal, timedOut, truncated });
    });
  });
}

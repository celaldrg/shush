// End-to-end demo: start `shush mcp` over stdio with the official MCP client SDK and call `run`.
// Usage: node scripts/demo.mjs '<json array of {command, cwd}>'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const calls = JSON.parse(process.argv[2] ?? '[{"command":"git log -5"}]');
const client = new Client({ name: "shush-demo", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], stderr: "ignore" }));
for (const args of calls) {
  const r = await client.callTool({ name: "run", arguments: args });
  console.log(`> run ${JSON.stringify(args.command)}${args.cwd ? `  (cwd ${args.cwd})` : ""}`);
  console.log(r.content[0].text);
  console.log();
}
await client.close();

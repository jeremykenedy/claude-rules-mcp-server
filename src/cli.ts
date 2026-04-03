#!/usr/bin/env node

import fs from "fs";
import path from "path";
import readline from "readline";

const BANNER = `
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝
██████╗ ██╗   ██╗██╗     ███████╗███████╗
██╔══██╗██║   ██║██║     ██╔════╝██╔════╝
██████╔╝██║   ██║██║     █████╗  ███████╗
██╔══██╗██║   ██║██║     ██╔══╝  ╚════██║
██║  ██║╚██████╔╝███████╗███████╗███████║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝╚══════╝
███╗   ███╗ ██████╗██████╗
████╗ ████║██╔════╝██╔══██╗
██╔████╔██║██║     ██████╔╝
██║╚██╔╝██║██║     ██╔═══╝
██║ ╚═╝ ██║╚██████╗██║
╚═╝     ╚═╝ ╚═════╝╚═╝
`;

const PALETTES = [
  ["\x1b[34m", "\x1b[35m", "\x1b[94m", "\x1b[95m", "\x1b[96m"],
  ["\x1b[31m", "\x1b[91m", "\x1b[33m", "\x1b[93m", "\x1b[31m"],
  ["\x1b[32m", "\x1b[92m", "\x1b[36m", "\x1b[96m", "\x1b[32m"],
  ["\x1b[33m", "\x1b[93m", "\x1b[91m", "\x1b[31m", "\x1b[33m"],
  ["\x1b[35m", "\x1b[95m", "\x1b[34m", "\x1b[94m", "\x1b[35m"],
  ["\x1b[36m", "\x1b[96m", "\x1b[92m", "\x1b[32m", "\x1b[36m"],
  ["\x1b[91m", "\x1b[93m", "\x1b[92m", "\x1b[96m", "\x1b[94m"],
];

const RESET = "\x1b[0m";

function renderBanner(): void {
  const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  const lines = BANNER.split("\n");
  lines.forEach((line, i) => {
    const color = palette[i % palette.length];
    console.log(`${color}${line}${RESET}`);
  });
  console.log("");
  console.log("  Claude Rules MCP Server v1.0.0");
  console.log("  Serve 484 skills and 17 rules to any Claude client");
  console.log("");
}

function ask(rl: readline.Interface, question: string, defaultVal?: string): Promise<string> {
  const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

function select(rl: readline.Interface, question: string, options: string[]): Promise<string> {
  console.log(`\n  ${question}`);
  options.forEach((opt, i) => console.log(`    ${i + 1}) ${opt}`));
  return new Promise((resolve) => {
    rl.question("\n  Select [1]: ", (answer) => {
      const idx = parseInt(answer.trim() || "1") - 1;
      resolve(options[Math.max(0, Math.min(idx, options.length - 1))]);
    });
  });
}

async function init(): Promise<void> {
  renderBanner();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("  Let's set up your Claude Rules MCP Server.\n");

  const transport = await select(rl, "Transport mode:", ["http (for Docker/remote)", "stdio (for Claude Desktop)"]);
  const port = transport.startsWith("http") ? await ask(rl, "  HTTP port", "3456") : "3456";
  const dataPath = await ask(rl, "  Path to .claude directory (skills + rules)", process.env.HOME + "/.claude");
  const projectsDir = await ask(rl, "  Path to projects directory", process.env.HOME + "/sites");

  let secret = "";
  if (transport.startsWith("http")) {
    console.log("\n  Token authentication protects your MCP server from unauthorized access.");
    secret = await ask(rl, "  MCP secret token (leave blank for no auth)", "");
  }

  // Write .env
  const envContent = [
    `TRANSPORT=${transport.startsWith("http") ? "http" : "stdio"}`,
    `PORT=${port}`,
    `CLAUDE_DATA_PATH=${dataPath}`,
    `CLAUDE_PROJECTS_DIR=${projectsDir}`,
    secret ? `MCP_SECRET=${secret}` : "# MCP_SECRET=your-secret-token",
  ].join("\n") + "\n";

  const envPath = path.join(process.cwd(), ".env");
  fs.writeFileSync(envPath, envContent);

  console.log(`\n  \x1b[32m✓\x1b[0m Configuration saved to ${envPath}`);
  console.log("");
  console.log("  Next steps:");
  console.log("    1. npm install && npm run build");
  console.log("    2. node dist/index.js");
  if (transport.startsWith("http")) {
    console.log(`    3. Health check: curl http://localhost:${port}/health`);
    if (secret) {
      console.log(`    4. MCP endpoint: http://localhost:${port}/mcp?token=${secret}`);
    }
  }
  console.log("");
  console.log("  For Docker deployment, see README.md");
  console.log("");

  rl.close();
}

async function run(): Promise<void> {
  // Load .env if exists
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach((line) => {
      if (line && !line.startsWith("#")) {
        const [key, ...vals] = line.split("=");
        if (key && vals.length) {
          process.env[key.trim()] = vals.join("=").trim();
        }
      }
    });
  }

  // Import and start the server
  await import("./index.js");
}

const command = process.argv[2];

if (command === "init") {
  init().catch(console.error);
} else if (command === "run" || !command) {
  run().catch(console.error);
} else {
  console.log("Usage: claude-rules-mcp [init|run]");
  console.log("");
  console.log("  init  Interactive setup wizard");
  console.log("  run   Start the MCP server (default)");
  process.exit(1);
}

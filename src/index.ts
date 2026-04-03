import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const DATA_PATH = process.env.CLAUDE_DATA_PATH || "/data/.claude";
const SKILLS_DIR = path.join(DATA_PATH, "skills");
const RULES_DIR = path.join(DATA_PATH, "rules");
const MANIFEST_FILE = path.join(DATA_PATH, "skills-manifest.json");
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || "/data/sites";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MCP_SECRET = process.env.MCP_SECRET || "";

const GLOBAL_RULES = [
  "artisan-commands", "banners", "commands", "conventions", "echo-broadcasting",
  "horizon", "laravel", "license", "livewire", "package-standards", "pest",
  "php", "readme", "socialite", "tailwind", "testing", "vibe-flow",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface SkillEntry {
  name: string;
  description: string;
  references?: number;
}

interface Manifest {
  total_skills: number;
  total_rules: number;
  skills: SkillEntry[];
  rules?: Array<{ name: string; file: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) return `[File too large: ${stat.size} bytes]`;
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function readManifest(): Promise<Manifest | null> {
  const raw = await safeReadFile(MANIFEST_FILE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

function formatSkillList(skills: SkillEntry[]): string {
  return skills
    .map((s) => `- **${s.name}**: ${s.description}${s.references ? ` _(${s.references} refs)_` : ""}`)
    .join("\n");
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "claude-rules-mcp-server", version: "2.0.0" });

// ── 1. rules_get_manifest ────────────────────────────────────────────────────
server.registerTool(
  "rules_get_manifest",
  {
    title: "Get Skills Manifest",
    description: `Returns the full skills-manifest.json — names and descriptions for all 484 skills plus 17 global rule names.
Use this first to discover what is available before fetching individual skills or rules.
Returns structured JSON: { total_skills, total_rules, skills[], rules[] }`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const manifest = await readManifest();
    if (!manifest) {
      return {
        content: [{ type: "text", text: `Manifest not found at: ${MANIFEST_FILE}\nRun sync-to-qnap.sh to sync from Mac first.` }],
      };
    }
    const slim = {
      total_skills: manifest.total_skills,
      total_rules: manifest.total_rules,
      skills: manifest.skills.map(({ name, description, references }) => ({
        name,
        description,
        ...(references ? { references } : {}),
      })),
      rules: GLOBAL_RULES.map((name) => ({ name })),
    };
    return { content: [{ type: "text", text: JSON.stringify(slim, null, 2) }] };
  }
);

// ── 2. rules_list_skills ─────────────────────────────────────────────────────
server.registerTool(
  "rules_list_skills",
  {
    title: "List All Skills",
    description: `Lists all 484 skills with names and descriptions, read from the manifest (fast — no filesystem scan).
Optionally filter by category or keyword.

Args:
  - filter (string, optional): Filter by name or description keyword (case-insensitive)

Returns: Formatted skill list with descriptions.`,
    inputSchema: {
      filter: z.string().optional().describe("Optional keyword to filter skill names/descriptions"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ filter }) => {
    const manifest = await readManifest();
    if (!manifest) {
      return { content: [{ type: "text", text: `Manifest not found at: ${MANIFEST_FILE}` }] };
    }
    let skills = manifest.skills;
    if (filter) {
      const q = filter.toLowerCase();
      skills = skills.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
    }
    if (skills.length === 0) {
      return { content: [{ type: "text", text: `No skills found matching "${filter}"` }] };
    }
    const header = filter
      ? `# Skills matching "${filter}" (${skills.length} of ${manifest.total_skills})`
      : `# All Skills (${manifest.total_skills} total)`;
    return { content: [{ type: "text", text: `${header}\n\n${formatSkillList(skills)}` }] };
  }
);

// ── 3. rules_get_skill ───────────────────────────────────────────────────────
server.registerTool(
  "rules_get_skill",
  {
    title: "Get Skill",
    description: `Reads the full SKILL.md for a specific skill by name.

Args:
  - skill_name (string): Exact skill name (e.g. "vue-expert", "php-pro", "laravel-auth")

Returns: Full SKILL.md content.`,
    inputSchema: {
      skill_name: z.string().min(1).describe("Exact skill name from the manifest"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ skill_name }) => {
    const filePath = path.join(SKILLS_DIR, skill_name, "SKILL.md");
    const content = await safeReadFile(filePath);
    if (!content) {
      return {
        content: [{ type: "text", text: `Skill "${skill_name}" not found at: ${filePath}\nUse rules_list_skills to see available skills.` }],
      };
    }
    return { content: [{ type: "text", text: `# Skill: ${skill_name}\n**Source:** ${filePath}\n\n---\n\n${content}` }] };
  }
);

// ── 4. rules_get_skill_references ────────────────────────────────────────────
server.registerTool(
  "rules_get_skill_references",
  {
    title: "Get Skill References",
    description: `Lists or reads reference files for a specific skill.
Many skills have 5-7 deep-dive reference docs in their references/ subdirectory.

Args:
  - skill_name (string): Exact skill name
  - filename (string, optional): Specific reference filename to read. If omitted, lists all references.

Returns: List of reference filenames, or full content of a specific reference file.`,
    inputSchema: {
      skill_name: z.string().min(1).describe("Exact skill name"),
      filename: z.string().optional().describe("Specific reference file to read (e.g. 'composition-api.md')"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ skill_name, filename }) => {
    const refsDir = path.join(SKILLS_DIR, skill_name, "references");

    if (filename) {
      const filePath = path.join(refsDir, filename);
      const content = await safeReadFile(filePath);
      if (!content) {
        return {
          content: [{ type: "text", text: `Reference "${filename}" not found for skill "${skill_name}".\nCall without filename to list available references.` }],
        };
      }
      return { content: [{ type: "text", text: `# ${skill_name} / ${filename}\n\n---\n\n${content}` }] };
    }

    try {
      const entries = await fs.readdir(refsDir, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);
      if (files.length === 0) {
        return { content: [{ type: "text", text: `No reference files found for skill "${skill_name}"` }] };
      }
      return {
        content: [{
          type: "text",
          text: `# References for: ${skill_name} (${files.length} files)\n\n${files.map((f) => `  - ${f}`).join("\n")}\n\nCall again with filename to read a specific reference.`,
        }],
      };
    } catch {
      return { content: [{ type: "text", text: `No references directory for skill "${skill_name}"` }] };
    }
  }
);

// ── 5. rules_list_global_rules ───────────────────────────────────────────────
server.registerTool(
  "rules_list_global_rules",
  {
    title: "List Global Rules",
    description: `Lists all 17 global rule names available in ~/.claude/rules/.
Rules: artisan-commands, banners, commands, conventions, echo-broadcasting, horizon, laravel,
license, livewire, package-standards, pest, php, readme, socialite, tailwind, testing, vibe-flow.
Use rules_get_global_rule to read a specific rule.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const found: string[] = [];
    const missing: string[] = [];
    for (const name of GLOBAL_RULES) {
      const p = path.join(RULES_DIR, `${name}.md`);
      const exists = await safeReadFile(p);
      (exists !== null ? found : missing).push(name);
    }
    const list = found.map((n) => `  - **${n}**`).join("\n");
    const missingNote = missing.length > 0 ? `\n\n⚠️ Not synced yet: ${missing.join(", ")}` : "";
    return {
      content: [{
        type: "text",
        text: `# Global Rules (${found.length}/17 synced)\n**Source:** ${RULES_DIR}/\n\n${list}${missingNote}`,
      }],
    };
  }
);

// ── 6. rules_get_global_rule ─────────────────────────────────────────────────
server.registerTool(
  "rules_get_global_rule",
  {
    title: "Get Global Rule",
    description: `Reads a specific global rule file by name from ~/.claude/rules/{name}.md.

Args:
  - rule_name (string): Rule name without .md (e.g. "php", "laravel", "conventions", "testing")
    Valid: artisan-commands, banners, commands, conventions, echo-broadcasting, horizon, laravel,
    license, livewire, package-standards, pest, php, readme, socialite, tailwind, testing, vibe-flow

Returns: Full rule file content.`,
    inputSchema: {
      rule_name: z.string().min(1).describe("Rule name without .md extension"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ rule_name }) => {
    const filePath = path.join(RULES_DIR, `${rule_name}.md`);
    const content = await safeReadFile(filePath);
    if (!content) {
      return {
        content: [{ type: "text", text: `Rule "${rule_name}" not found at: ${filePath}\nValid rules: ${GLOBAL_RULES.join(", ")}` }],
      };
    }
    return { content: [{ type: "text", text: `# Rule: ${rule_name}\n**Source:** ${filePath}\n\n---\n\n${content}` }] };
  }
);

// ── 7. rules_get_global (all rules) ──────────────────────────────────────────
server.registerTool(
  "rules_get_global",
  {
    title: "Get All Global Rules",
    description: `Reads and concatenates ALL 17 global rule files into one response.
Use this to load your complete global ruleset into context at once.
For a single rule, use rules_get_global_rule instead.

Returns: All 17 rules concatenated with section headers.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const sections: string[] = [];
    for (const name of GLOBAL_RULES) {
      const filePath = path.join(RULES_DIR, `${name}.md`);
      const content = await safeReadFile(filePath);
      if (content) {
        sections.push(`## Rule: ${name}\n_Source: ${filePath}_\n\n${content}`);
      }
    }
    if (sections.length === 0) {
      return {
        content: [{ type: "text", text: `No rule files found in: ${RULES_DIR}\nRun sync-to-qnap.sh to sync from Mac first.` }],
      };
    }
    return {
      content: [{ type: "text", text: `# All Global Rules (${sections.length}/17)\n\n---\n\n${sections.join("\n\n---\n\n")}` }],
    };
  }
);

// ── 8. rules_get_project ─────────────────────────────────────────────────────
server.registerTool(
  "rules_get_project",
  {
    title: "Get Project Rules",
    description: `Reads CLAUDE.md and all .claude/rules/*.md files for a specific project.

Args:
  - project_name (string): Project folder name under ~/sites (e.g. "laravel-auth-modernized", "greenboard")

Returns: Project CLAUDE.md and all project-level rule files concatenated.`,
    inputSchema: {
      project_name: z.string().min(1).describe("Project folder name under ~/sites"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ project_name }) => {
    const projectBase = path.join(PROJECTS_DIR, project_name, ".claude");
    const sections: string[] = [];

    for (const claudeFile of ["CLAUDE.md", "claude.md"]) {
      const p = path.join(projectBase, claudeFile);
      const content = await safeReadFile(p);
      if (content) {
        sections.push(`## CLAUDE.md\n_Source: ${p}_\n\n${content}`);
        break;
      }
    }

    const rulesDir = path.join(projectBase, "rules");
    try {
      const entries = await fs.readdir(rulesDir, { withFileTypes: true });
      const ruleFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md"));
      for (const file of ruleFiles) {
        const filePath = path.join(rulesDir, file.name);
        const content = await safeReadFile(filePath);
        if (content) {
          sections.push(`## Rule: ${file.name.replace(".md", "")}\n_Source: ${filePath}_\n\n${content}`);
        }
      }
    } catch {
      // no rules dir — fine
    }

    if (sections.length === 0) {
      return {
        content: [{ type: "text", text: `No Claude rules found for project "${project_name}".\nChecked: ${projectBase}` }],
      };
    }
    return {
      content: [{ type: "text", text: `# Project Rules: ${project_name}\n\n---\n\n${sections.join("\n\n---\n\n")}` }],
    };
  }
);

// ── 9. rules_list_projects ───────────────────────────────────────────────────
server.registerTool(
  "rules_list_projects",
  {
    title: "List Projects with Claude Rules",
    description: `Scans the projects directory and lists all projects that have a .claude/ directory.

Returns: List of project names with Claude rules configured.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    try {
      const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
      const projects: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const claudeDir = path.join(PROJECTS_DIR, entry.name, ".claude");
        try {
          await fs.access(claudeDir);
          projects.push(entry.name);
        } catch {
          // no .claude dir
        }
      }
      if (projects.length === 0) {
        return { content: [{ type: "text", text: `No projects with .claude/ found in: ${PROJECTS_DIR}` }] };
      }
      return {
        content: [{
          type: "text",
          text: `# Projects with Claude Rules\n**Base:** ${PROJECTS_DIR}\n\n${projects.map((p) => `  - ${p}`).join("\n")}\n\n**Total:** ${projects.length}`,
        }],
      };
    } catch {
      return { content: [{ type: "text", text: `Projects directory not accessible: ${PROJECTS_DIR}` }] };
    }
  }
);

// ── 10. rules_search ─────────────────────────────────────────────────────────
server.registerTool(
  "rules_search",
  {
    title: "Search Rules and Skills",
    description: `Keyword search across skill descriptions (from manifest) and global rule file contents.

Args:
  - query (string): Search keyword or phrase
  - scope ("skills" | "rules" | "all"): Where to search (default: "all")

Returns: Matching skill names/descriptions and rule excerpts with line numbers.`,
    inputSchema: {
      query: z.string().min(1).max(200).describe("Search keyword or phrase"),
      scope: z.enum(["skills", "rules", "all"]).default("all").describe("Search scope"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ query, scope }) => {
    const q = query.toLowerCase();
    const results: string[] = [];

    if (scope === "skills" || scope === "all") {
      const manifest = await readManifest();
      if (manifest) {
        const matches = manifest.skills.filter(
          (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
        );
        if (matches.length > 0) {
          const shown = matches.slice(0, 30);
          results.push(
            `## Skills (${matches.length} matches)\n\n${formatSkillList(shown)}${matches.length > 30 ? `\n\n_...and ${matches.length - 30} more_` : ""}`
          );
        }
      }
    }

    if (scope === "rules" || scope === "all") {
      for (const name of GLOBAL_RULES) {
        const filePath = path.join(RULES_DIR, `${name}.md`);
        const content = await safeReadFile(filePath);
        if (!content) continue;
        const lines = content.split("\n");
        const matchLines: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(q)) {
            const ctx = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join("\n");
            matchLines.push(`[Line ${i + 1}]\n${ctx}`);
          }
        }
        if (matchLines.length > 0) {
          results.push(`## Rule: ${name}\n${matchLines.slice(0, 5).join("\n\n")}`);
        }
      }
    }

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No matches for "${query}" in scope: ${scope}` }] };
    }
    return { content: [{ type: "text", text: `# Search: "${query}"\n\n${results.join("\n\n---\n\n")}` }] };
  }
);

// ─── Monitor Summary Tool ─────────────────────────────────────────────────────

server.tool(
  "read_monitor_summary",
  "Read the latest monitor summary (Gmail job/legal alerts + Oregon court case updates). Check this at the start of every conversation to see if there are new job leads, legal updates, or urgent items.",
  {},
  async () => {
    const summaryPath = path.join(DATA_PATH, "monitor-summary.md");
    const content = await safeReadFile(summaryPath);
    if (!content) {
      return { content: [{ type: "text", text: "No monitor summary available yet. Monitors may not have run." }] };
    }
    return { content: [{ type: "text", text: content }] };
  }
);

// ─── Transport ────────────────────────────────────────────────────────────────

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Token auth middleware for /mcp endpoint
  function checkAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!MCP_SECRET) { next(); return; }
    const token = (req.query.token as string) || req.headers.authorization?.replace("Bearer ", "");
    if (token === MCP_SECRET) { next(); return; }
    res.status(401).json({ error: "Unauthorized" });
  }

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "claude-rules-mcp-server",
      version: "2.0.0",
      data_path: DATA_PATH,
      projects_dir: PROJECTS_DIR,
    });
  });

  app.post("/mcp", checkAuth, async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3456");
  app.listen(port, () => {
    console.error(`claude-rules-mcp-server v2.0.0 on http://0.0.0.0:${port}/mcp`);
    console.error(`DATA_PATH=${DATA_PATH} | PROJECTS_DIR=${PROJECTS_DIR}`);
  });
}

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const transportMode = process.env.TRANSPORT || "stdio";
if (transportMode === "http") {
  runHTTP().catch((err) => { console.error("Server error:", err); process.exit(1); });
} else {
  runStdio().catch((err) => { console.error("Server error:", err); process.exit(1); });
}

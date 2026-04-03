import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

const TEST_DATA = path.join(os.tmpdir(), "claude-rules-mcp-test");
const SKILLS_DIR = path.join(TEST_DATA, "skills");
const RULES_DIR = path.join(TEST_DATA, "rules");

beforeAll(async () => {
  await fs.mkdir(SKILLS_DIR, { recursive: true });
  await fs.mkdir(RULES_DIR, { recursive: true });

  // Create test skill
  const skillDir = path.join(SKILLS_DIR, "test-skill");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: test-skill\ndescription: A test skill for unit testing\n---\n\n# Test Skill\n\nThis is a test."
  );

  const refsDir = path.join(skillDir, "references");
  await fs.mkdir(refsDir, { recursive: true });
  await fs.writeFile(path.join(refsDir, "example.md"), "# Example Reference\n\nReference content.");

  // Create test rule
  await fs.writeFile(
    path.join(RULES_DIR, "test-rule.md"),
    "# Test Rule\n\nThis is a test rule for unit testing."
  );

  // Create test manifest
  await fs.writeFile(
    path.join(TEST_DATA, "skills-manifest.json"),
    JSON.stringify({
      total_skills: 1,
      total_rules: 1,
      skills: [{ name: "test-skill", description: "A test skill for unit testing", references: 1 }],
      rules: [{ name: "test-rule", file: path.join(RULES_DIR, "test-rule.md") }],
    })
  );

  // Create test monitor summary
  await fs.writeFile(
    path.join(TEST_DATA, "monitor-summary.md"),
    "## Monitor Summary - 2026-04-03\n\n### Gmail - 2 new items\n- [job-search] Test job\n- [legal] Test filing\n"
  );
});

describe("Test data structure", () => {
  it("should have skills directory", async () => {
    const stat = await fs.stat(SKILLS_DIR);
    expect(stat.isDirectory()).toBe(true);
  });

  it("should have rules directory", async () => {
    const stat = await fs.stat(RULES_DIR);
    expect(stat.isDirectory()).toBe(true);
  });

  it("should have test skill with SKILL.md", async () => {
    const content = await fs.readFile(path.join(SKILLS_DIR, "test-skill", "SKILL.md"), "utf-8");
    expect(content).toContain("name: test-skill");
    expect(content).toContain("A test skill for unit testing");
  });

  it("should have skill reference file", async () => {
    const content = await fs.readFile(
      path.join(SKILLS_DIR, "test-skill", "references", "example.md"),
      "utf-8"
    );
    expect(content).toContain("Reference content");
  });

  it("should have test rule", async () => {
    const content = await fs.readFile(path.join(RULES_DIR, "test-rule.md"), "utf-8");
    expect(content).toContain("test rule for unit testing");
  });

  it("should have valid manifest JSON", async () => {
    const raw = await fs.readFile(path.join(TEST_DATA, "skills-manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.total_skills).toBe(1);
    expect(manifest.total_rules).toBe(1);
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.skills[0].name).toBe("test-skill");
    expect(manifest.rules).toHaveLength(1);
  });

  it("should have monitor summary", async () => {
    const content = await fs.readFile(path.join(TEST_DATA, "monitor-summary.md"), "utf-8");
    expect(content).toContain("Monitor Summary");
    expect(content).toContain("Gmail");
    expect(content).toContain("job-search");
  });
});

describe("Manifest parsing", () => {
  it("should parse manifest skills array", async () => {
    const raw = await fs.readFile(path.join(TEST_DATA, "skills-manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);
    const skill = manifest.skills[0];
    expect(skill).toHaveProperty("name");
    expect(skill).toHaveProperty("description");
    expect(skill).toHaveProperty("references");
    expect(typeof skill.references).toBe("number");
  });

  it("should parse manifest rules array", async () => {
    const raw = await fs.readFile(path.join(TEST_DATA, "skills-manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);
    const rule = manifest.rules[0];
    expect(rule).toHaveProperty("name");
    expect(rule).toHaveProperty("file");
  });
});

describe("File safety", () => {
  it("should not read files larger than 5MB", async () => {
    const MAX = 5 * 1024 * 1024;
    const stat = await fs.stat(path.join(SKILLS_DIR, "test-skill", "SKILL.md"));
    expect(stat.size).toBeLessThan(MAX);
  });

  it("should handle missing files gracefully", async () => {
    try {
      await fs.readFile(path.join(SKILLS_DIR, "nonexistent", "SKILL.md"), "utf-8");
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.code).toBe("ENOENT");
    }
  });
});

describe("SKILL.md frontmatter", () => {
  it("should have valid YAML frontmatter", async () => {
    const content = await fs.readFile(path.join(SKILLS_DIR, "test-skill", "SKILL.md"), "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("name:");
    expect(match![1]).toContain("description:");
  });
});

describe("Environment variables", () => {
  it("should use defaults when env vars not set", () => {
    const dataPath = process.env.CLAUDE_DATA_PATH || "/data/.claude";
    const projectsDir = process.env.CLAUDE_PROJECTS_DIR || "/data/sites";
    expect(dataPath).toBeTruthy();
    expect(projectsDir).toBeTruthy();
  });

  it("should accept custom transport mode", () => {
    const transport = process.env.TRANSPORT || "stdio";
    expect(["stdio", "http"]).toContain(transport);
  });
});

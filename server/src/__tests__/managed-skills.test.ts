import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  managedSkillScopes,
  managedSkills,
  projects,
} from "@paperclipai/db";
import { managedSkillService, materializeEffectiveSkills } from "../services/managed-skills.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
}) => EmbeddedPostgresInstance;

const tempPaths: string[] = [];
const runningInstances: EmbeddedPostgresInstance[] = [];

async function getEmbeddedPostgresCtor(): Promise<EmbeddedPostgresCtor> {
  const mod = await import("embedded-postgres");
  return mod.default as EmbeddedPostgresCtor;
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate test port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function createTempDatabase(): Promise<string> {
  const EmbeddedPostgres = await getEmbeddedPostgresCtor();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-managed-skills-"));
  tempPaths.push(dataDir);

  const port = await getAvailablePort();
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password: "paperclip",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  await instance.initialise();
  await instance.start();
  runningInstances.push(instance);

  const adminUrl = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
  await ensurePostgresDatabase(adminUrl, "paperclip");
  return `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
}

async function createBuiltInSkill(root: string, name: string, description: string, body = "Built-in body") {
  const skillDir = path.join(root, name);
  await fs.promises.mkdir(skillDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`,
    "utf8",
  );
}

afterEach(async () => {
  while (runningInstances.length > 0) {
    const instance = runningInstances.pop();
    if (!instance) continue;
    await instance.stop();
  }

  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (!tempPath) continue;
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("managedSkillService.resolveEffectiveSkills", () => {
  it("returns built-in skills when no managed overrides exist", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);
    const service = managedSkillService(db);
    const builtInRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-builtins-"));
    tempPaths.push(builtInRoot);

    await createBuiltInSkill(builtInRoot, "paperclip", "Built in skill", "Built-in coordination skill");

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "PAP" }).returning();

    const resolved = await service.resolveEffectiveSkills({
      companyId: company.id,
      moduleDir: "/tmp/does-not-matter",
      additionalBuiltInSkillDirs: [builtInRoot],
    });

    expect(resolved).toEqual([
      expect.objectContaining({
        name: "paperclip",
        description: "Built in skill",
        sourceType: "builtin",
        managedSkillId: null,
      }),
    ]);
  });

  it("allows duplicate managed-skill slugs so scoped overrides can coexist", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);
    const service = managedSkillService(db);
    const companyId = crypto.randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      slug: `paperclip-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    });

    const first = await service.createManagedSkill(companyId, {
      name: "Research UI Company",
      slug: "research-ui",
      description: "Company override",
      bodyMarkdown: "# Company\n",
      status: "active",
    });
    const second = await service.createManagedSkill(companyId, {
      name: "Research UI Project",
      slug: "research-ui",
      description: "Project override",
      bodyMarkdown: "# Project\n",
      status: "active",
    });

    expect(first.slug).toBe("research-ui");
    expect(second.slug).toBe("research-ui");
    expect(second.id).not.toBe(first.id);

    const listed = await service.listManagedSkills(companyId);
    expect(listed.filter((skill) => skill.slug === "research-ui")).toHaveLength(2);
  });

  it("applies company, project, and agent precedence over built-ins", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);
    const service = managedSkillService(db);
    const builtInRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-builtins-"));
    tempPaths.push(builtInRoot);

    await createBuiltInSkill(builtInRoot, "research-ui", "Built in skill", "Built-in body");
    await createBuiltInSkill(builtInRoot, "baseline", "Baseline built in", "Baseline body");

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "PAP" }).returning();
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Sprint 0", urlKey: "sprint-0" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Hermes Engineer",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();

    const [companySkill] = await db.insert(managedSkills).values({
      companyId: company.id,
      name: "Research UI Company",
      slug: "research-ui",
      description: "Company override",
      bodyMarkdown: "# Company\n",
      status: "active",
    }).returning();
    const [projectSkill] = await db.insert(managedSkills).values({
      companyId: company.id,
      name: "Research UI Project",
      slug: "research-ui",
      description: "Project override",
      bodyMarkdown: "# Project\n",
      status: "active",
    }).returning();
    const [agentSkill] = await db.insert(managedSkills).values({
      companyId: company.id,
      name: "Research UI Agent",
      slug: "research-ui",
      description: "Agent override",
      bodyMarkdown: "# Agent\n",
      status: "active",
    }).returning();

    await db.insert(managedSkillScopes).values([
      {
        skillId: companySkill.id,
        companyId: company.id,
        scopeType: "company",
        scopeId: company.id,
        enabled: true,
      },
      {
        skillId: projectSkill.id,
        companyId: company.id,
        scopeType: "project",
        scopeId: project.id,
        projectId: project.id,
        enabled: true,
      },
      {
        skillId: agentSkill.id,
        companyId: company.id,
        scopeType: "agent",
        scopeId: agent.id,
        agentId: agent.id,
        enabled: true,
      },
    ]);

    const resolved = await service.resolveEffectiveSkills({
      companyId: company.id,
      projectId: project.id,
      agentId: agent.id,
      moduleDir: "/tmp/does-not-matter",
      additionalBuiltInSkillDirs: [builtInRoot],
    });

    expect(resolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "baseline",
          sourceType: "builtin",
        }),
        expect.objectContaining({
          name: "research-ui",
          sourceType: "agent",
          description: "Agent override",
          bodyMarkdown: "# Agent\n",
          managedSkillId: agentSkill.id,
          scopeId: agent.id,
        }),
      ]),
    );
  });

  it("excludes archived skills and disabled scopes", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);
    const service = managedSkillService(db);
    const companyId = crypto.randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      slug: `paperclip-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    });

    const [activeSkill] = await db.insert(managedSkills).values({
      companyId,
      name: "Active skill",
      slug: "active-skill",
      description: "active",
      bodyMarkdown: "# active",
      status: "active",
    }).returning();

    const [archivedSkill] = await db.insert(managedSkills).values({
      companyId,
      name: "Archived skill",
      slug: "archived-skill",
      description: "archived",
      bodyMarkdown: "# archived",
      status: "archived",
    }).returning();

    await db.insert(managedSkillScopes).values([
      {
        companyId,
        skillId: activeSkill.id,
        scopeType: "company",
        scopeId: null,
        enabled: false,
      },
      {
        companyId,
        skillId: archivedSkill.id,
        scopeType: "company",
        scopeId: null,
        enabled: true,
      },
    ]);

    const resolved = await service.resolveEffectiveSkills({
      companyId,
      moduleDir: process.cwd(),
      additionalBuiltInSkillDirs: [],
    });

    expect(resolved).toEqual([]);
  });

  it("materializes effective skills into a runtime skills directory", async () => {
    const runtimeRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "paperclip-materialized-skills-"));
    tempPaths.push(runtimeRoot);

    const result = await materializeEffectiveSkills({
      outputRoot: runtimeRoot,
      skills: [
        {
          name: "Managed Skill",
          description: "managed",
          bodyMarkdown: "---\nname: managed-skill\n---\n# managed",
          sourceType: "agent",
          sourceLabel: "agent",
          managedSkillId: "skill-1",
          scopeId: "agent-1",
        },
      ],
    });

    expect(result.skillsEntries).toEqual([
      {
        name: "managed skill",
        source: path.join(result.skillsDir, "managed skill"),
      },
    ]);
    await expect(fs.promises.readFile(path.join(result.skillsDir, "managed skill", "SKILL.md"), "utf8")).resolves.toContain("# managed");
  });
});

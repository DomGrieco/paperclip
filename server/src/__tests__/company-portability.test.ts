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
import { companyPortabilityService } from "../services/company-portability.js";
import { managedSkillService } from "../services/managed-skills.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-company-portability-"));
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

function managedSkillMarkdown(name: string, description: string, heading = name) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${heading}\n`;
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

describe("companyPortabilityService managed skills", () => {
  it("exports managed skills and skips project-only scopes with warnings", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);
    const portability = companyPortabilityService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "PAP" }).returning();
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Project", urlKey: "project" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Hermes Engineer",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: { promptTemplate: "# Agent\n" },
      runtimeConfig: {},
      permissions: {},
    }).returning();

    const [companySkill] = await db.insert(managedSkills).values({
      companyId: company.id,
      name: "Research UI Company",
      slug: "research-ui",
      description: "Company scoped",
      bodyMarkdown: managedSkillMarkdown("Research UI Company", "Company scoped"),
      status: "active",
    }).returning();
    const [agentSkill] = await db.insert(managedSkills).values({
      companyId: company.id,
      name: "Research UI Agent",
      slug: "research-ui",
      description: "Agent scoped",
      bodyMarkdown: managedSkillMarkdown("Research UI Agent", "Agent scoped"),
      status: "archived",
    }).returning();
    const [projectSkill] = await db.insert(managedSkills).values({
      companyId: company.id,
      name: "Research UI Project",
      slug: "research-ui",
      description: "Project scoped",
      bodyMarkdown: managedSkillMarkdown("Research UI Project", "Project scoped"),
      status: "active",
    }).returning();

    await db.insert(managedSkillScopes).values([
      {
        companyId: company.id,
        skillId: companySkill.id,
        scopeType: "company",
        scopeId: company.id,
        enabled: true,
      },
      {
        companyId: company.id,
        skillId: agentSkill.id,
        scopeType: "agent",
        scopeId: agent.id,
        agentId: agent.id,
        enabled: true,
      },
      {
        companyId: company.id,
        skillId: projectSkill.id,
        scopeType: "project",
        scopeId: project.id,
        projectId: project.id,
        enabled: true,
      },
    ]);

    const exported = await portability.exportBundle(company.id, {
      include: { company: true, agents: true, managedSkills: true },
    });

    expect(exported.manifest.includes.managedSkills).toBe(true);
    expect(exported.manifest.managedSkills).toHaveLength(2);
    expect(exported.manifest.managedSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "research-ui",
          status: "active",
          scopes: [{ scopeType: "company", agentSlug: null }],
        }),
        expect.objectContaining({
          slug: "research-ui",
          status: "archived",
          scopes: [{ scopeType: "agent", agentSlug: "hermes-engineer" }],
        }),
      ]),
    );
    expect(Object.keys(exported.files).filter((key) => key.startsWith("managed-skills/"))).toHaveLength(2);
    expect(exported.warnings.some((warning) => warning.includes("project portability is not supported"))).toBe(true);
    expect(exported.warnings.some((warning) => warning.includes("has no portable scopes"))).toBe(true);
  });

  it("imports exported managed skills into a new company and remaps agent scopes", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);
    const portability = companyPortabilityService(db);
    const managedSkillsSvc = managedSkillService(db);

    const [company] = await db.insert(companies).values({ name: "Source", issuePrefix: "SRC" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Hermes Engineer",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: { promptTemplate: "# Agent\n" },
      runtimeConfig: {},
      permissions: {},
    }).returning();

    const [companySkill] = await db.insert(managedSkills).values({
      companyId: company.id,
      name: "Research UI Company",
      slug: "research-ui",
      description: "Company scoped",
      bodyMarkdown: managedSkillMarkdown("Research UI Company", "Company scoped"),
      status: "active",
    }).returning();
    const [agentSkill] = await db.insert(managedSkills).values({
      companyId: company.id,
      name: "Research UI Agent",
      slug: "research-ui",
      description: "Agent scoped",
      bodyMarkdown: managedSkillMarkdown("Research UI Agent", "Agent scoped"),
      status: "archived",
    }).returning();

    await db.insert(managedSkillScopes).values([
      {
        companyId: company.id,
        skillId: companySkill.id,
        scopeType: "company",
        scopeId: company.id,
        enabled: true,
      },
      {
        companyId: company.id,
        skillId: agentSkill.id,
        scopeType: "agent",
        scopeId: agent.id,
        agentId: agent.id,
        enabled: true,
      },
    ]);

    const exported = await portability.exportBundle(company.id, {
      include: { company: true, agents: true, managedSkills: true },
    });

    const imported = await portability.importBundle({
      source: {
        type: "inline",
        manifest: exported.manifest,
        files: exported.files,
      },
      include: { company: true, agents: true, managedSkills: true },
      target: { mode: "new_company", newCompanyName: "Imported" },
      agents: "all",
      collisionStrategy: "rename",
    }, "user-1");

    expect(imported.managedSkills).toHaveLength(2);

    const importedSkills = await managedSkillsSvc.listManagedSkills(imported.company.id);
    expect(importedSkills).toHaveLength(2);

    const importedCompanySkill = importedSkills.find((skill) => skill.name === "Research UI Company");
    const importedAgentSkill = importedSkills.find((skill) => skill.name === "Research UI Agent");

    expect(importedCompanySkill?.status).toBe("active");
    expect(importedAgentSkill?.status).toBe("archived");

    const companyRecord = await managedSkillsSvc.getManagedSkillRecord(imported.company.id, importedCompanySkill!.id);
    const agentRecord = await managedSkillsSvc.getManagedSkillRecord(imported.company.id, importedAgentSkill!.id);

    expect(companyRecord.scopes.map((scope) => scope.scopeType)).toEqual(["company"]);
    expect(agentRecord.scopes.map((scope) => scope.scopeType)).toEqual(["agent"]);
    expect(agentRecord.scopes[0]?.agentId).toBe(imported.agents[0]?.id);
  });

  it("previews managed-skill collisions and unresolved agent scopes", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);
    const portability = companyPortabilityService(db);

    const [targetCompany] = await db.insert(companies).values({ name: "Target", issuePrefix: "TGT" }).returning();
    const [existingAgent] = await db.insert(agents).values({
      companyId: targetCompany.id,
      name: "Hermes Engineer",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: { promptTemplate: "# Agent\n" },
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [existingSkill] = await db.insert(managedSkills).values({
      companyId: targetCompany.id,
      name: "Research UI Company",
      slug: "research-ui",
      description: "Existing company scoped",
      bodyMarkdown: managedSkillMarkdown("Research UI Company", "Existing company scoped"),
      status: "active",
    }).returning();
    await db.insert(managedSkillScopes).values({
      companyId: targetCompany.id,
      skillId: existingSkill.id,
      scopeType: "company",
      scopeId: targetCompany.id,
      enabled: true,
    });

    const preview = await portability.previewImport({
      source: {
        type: "inline",
        manifest: {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          source: { companyId: targetCompany.id, companyName: "Source" },
          includes: { company: true, agents: false, managedSkills: true },
          company: null,
          agents: [],
          managedSkills: [
            {
              slug: "research-ui",
              name: "Research UI Company",
              path: "managed-skills/research-ui/SKILL.md",
              description: "Imported company scoped",
              status: "active",
              scopes: [{ scopeType: "company", agentSlug: null }],
            },
            {
              slug: "research-ui-agent",
              name: "Research UI Agent",
              path: "managed-skills/research-ui-agent/SKILL.md",
              description: "Imported agent scoped",
              status: "active",
              scopes: [{ scopeType: "agent", agentSlug: "missing-agent" }],
            },
          ],
          requiredSecrets: [],
        },
        files: {
          "managed-skills/research-ui/SKILL.md": managedSkillMarkdown("Research UI Company", "Imported company scoped"),
          "managed-skills/research-ui-agent/SKILL.md": managedSkillMarkdown("Research UI Agent", "Imported agent scoped"),
        },
      },
      include: { company: false, agents: false, managedSkills: true },
      target: { mode: "existing_company", companyId: targetCompany.id },
      collisionStrategy: "rename",
    });

    expect(existingAgent.id).toBeTruthy();
    expect(preview.plan.managedSkillPlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "research-ui",
          action: "create",
          plannedSlug: "research-ui-2",
        }),
      ]),
    );
    expect(preview.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("references unresolved agent scope missing-agent"),
      ]),
    );
  });
});

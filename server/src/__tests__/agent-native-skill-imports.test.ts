import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  managedSkillScopes,
  managedSkills,
} from "@paperclipai/db";
import { importNativeSkillsFromCompletedRun } from "../services/agent-native-skill-imports.js";
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-native-skill-imports-"));
  tempPaths.push(dataDir);

  const port = await getAvailablePort();
  const password = "paperclip";
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password,
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  await instance.initialise();
  await instance.start();
  runningInstances.push(instance);

  const adminUrl = `postgres://paperclip:${password}@127.0.0.1:${port}/postgres`;
  await ensurePostgresDatabase(adminUrl, "paperclip");
  return `postgres://paperclip:${password}@127.0.0.1:${port}/paperclip`;
}

function managedSkillMarkdown(name: string, description: string, heading = name, body = "Imported body") {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${heading}\n\n${body}\n`;
}

afterEach(async () => {
  vi.unstubAllEnvs();
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

describe("importNativeSkillsFromCompletedRun", () => {
  it("imports authored native skills as pending_review with provenance and skips projected symlinks", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);
    const service = managedSkillService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "PAP" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Codex Worker",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-native-home-"));
    const paperclipHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-instance-home-"));
    tempPaths.push(workspaceRoot, paperclipHome);
    vi.stubEnv("PAPERCLIP_HOME", paperclipHome);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
    const skillsRoot = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      company.id,
      "agents",
      agent.id,
      "homes",
      "codex_local",
      "skills",
    );
    await fs.promises.mkdir(skillsRoot, { recursive: true });

    const projectedSource = path.join(workspaceRoot, ".paperclip", "runtime", "skills", "projected-skill");
    await fs.promises.mkdir(projectedSource, { recursive: true });
    await fs.promises.writeFile(
      path.join(projectedSource, "SKILL.md"),
      managedSkillMarkdown("Projected Skill", "Projected"),
      "utf8",
    );
    await fs.promises.symlink(projectedSource, path.join(skillsRoot, "projected-skill"));

    const authoredDir = path.join(skillsRoot, "native-research");
    await fs.promises.mkdir(authoredDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(authoredDir, "SKILL.md"),
      managedSkillMarkdown("Native Research", "Imported from native home", "Native Research", "Use the native skill"),
      "utf8",
    );

    const runId = crypto.randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: company.id,
      agentId: agent.id,
      status: "completed",
      runType: "worker",
      updatedAt: new Date(),
    });

    const imported = await importNativeSkillsFromCompletedRun(db, {
      companyId: company.id,
      agentId: agent.id,
      runId,
      adapterType: "codex_local",
      executionWorkspaceCwd: workspaceRoot,
      executionConfig: {},
    });

    expect(imported).toHaveLength(1);
    expect(imported[0]).toEqual(
      expect.objectContaining({
        name: "Native Research",
        slug: "native-research",
        sourcePath: authoredDir,
      }),
    );

    const stored = await db
      .select()
      .from(managedSkills)
      .where(eq(managedSkills.id, imported[0]!.id))
      .then((rows) => rows[0] ?? null);
    expect(stored).toEqual(
      expect.objectContaining({
        companyId: company.id,
        name: "Native Research",
        slug: "native-research",
        status: "pending_review",
        importedFromAgentId: agent.id,
        importedSourcePath: authoredDir,
      }),
    );
    expect(stored?.importedFromRunId).toBe(runId);
    expect(stored?.importedAt).toBeInstanceOf(Date);

    await db.insert(managedSkillScopes).values({
      skillId: imported[0]!.id,
      companyId: company.id,
      scopeType: "company",
      scopeId: company.id,
      enabled: true,
      updatedAt: new Date(),
    });

    const resolved = await service.resolveEffectiveSkills({
      companyId: company.id,
      moduleDir: workspaceRoot,
      additionalBuiltInSkillDirs: [],
    });
    expect(resolved.find((entry) => entry.name === "native-research")).toBeUndefined();
  });

  it("refreshes an existing pending_review import from the same source path", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "PAP" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Hermes Worker",
      role: "engineer",
      adapterType: "hermes_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-native-home-refresh-"));
    const paperclipHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-instance-home-refresh-"));
    tempPaths.push(workspaceRoot, paperclipHome);
    vi.stubEnv("PAPERCLIP_HOME", paperclipHome);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
    const skillsRoot = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      company.id,
      "agents",
      agent.id,
      "homes",
      "hermes_local",
      "skills",
    );
    await fs.promises.mkdir(skillsRoot, { recursive: true });
    const authoredDir = path.join(skillsRoot, "native-memory");
    await fs.promises.mkdir(authoredDir, { recursive: true });

    const firstRunId = crypto.randomUUID();
    await db.insert(heartbeatRuns).values({
      id: firstRunId,
      companyId: company.id,
      agentId: agent.id,
      status: "completed",
      runType: "worker",
      updatedAt: new Date(),
    });
    await fs.promises.writeFile(
      path.join(authoredDir, "SKILL.md"),
      managedSkillMarkdown("Native Memory", "First draft", "First Draft", "Initial import"),
      "utf8",
    );

    const firstImport = await importNativeSkillsFromCompletedRun(db, {
      companyId: company.id,
      agentId: agent.id,
      runId: firstRunId,
      adapterType: "hermes_local",
      executionWorkspaceCwd: workspaceRoot,
      executionConfig: {},
    });
    expect(firstImport).toHaveLength(1);

    await fs.promises.writeFile(
      path.join(authoredDir, "SKILL.md"),
      managedSkillMarkdown("Native Memory", "First draft", "Updated Draft", "Updated import"),
      "utf8",
    );

    const secondRunId = crypto.randomUUID();
    await db.insert(heartbeatRuns).values({
      id: secondRunId,
      companyId: company.id,
      agentId: agent.id,
      status: "completed",
      runType: "worker",
      updatedAt: new Date(),
    });
    const secondImport = await importNativeSkillsFromCompletedRun(db, {
      companyId: company.id,
      agentId: agent.id,
      runId: secondRunId,
      adapterType: "hermes_local",
      executionWorkspaceCwd: workspaceRoot,
      executionConfig: {},
    });
    expect(secondImport).toHaveLength(1);
    expect(secondImport[0]!.id).toBe(firstImport[0]!.id);

    const rows = await db.select().from(managedSkills).where(eq(managedSkills.companyId, company.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending_review");
    expect(rows[0]?.bodyMarkdown).toContain("Updated import");
    expect(rows[0]?.importedFromRunId).toBe(secondRunId);
  });

  it("does not overwrite an already-reviewed managed skill imported from the same source path", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "PAP" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Cursor Worker",
      role: "engineer",
      adapterType: "cursor",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-cursor-native-home-"));
    tempPaths.push(workspaceRoot);
    const cursorHome = path.join(workspaceRoot, ".paperclip", "cursor-home");
    const skillsRoot = path.join(cursorHome, ".cursor", "skills");
    const authoredDir = path.join(skillsRoot, "cursor-native");
    await fs.promises.mkdir(authoredDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(authoredDir, "SKILL.md"),
      managedSkillMarkdown("Cursor Native", "Imported from cursor home", "Cursor Native", "new body"),
      "utf8",
    );

    const existingId = crypto.randomUUID();
    await db.insert(managedSkills).values({
      id: existingId,
      companyId: company.id,
      name: "Cursor Native",
      slug: "cursor-native",
      description: "Reviewed version",
      bodyMarkdown: managedSkillMarkdown("Cursor Native", "Reviewed version", "Cursor Native", "reviewed body"),
      status: "active",
      importedFromAgentId: agent.id,
      importedSourcePath: authoredDir,
      importedAt: new Date(),
      updatedAt: new Date(),
    });

    const runId = crypto.randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: company.id,
      agentId: agent.id,
      status: "completed",
      runType: "worker",
      updatedAt: new Date(),
    });

    const imported = await importNativeSkillsFromCompletedRun(db, {
      companyId: company.id,
      agentId: agent.id,
      runId,
      adapterType: "cursor",
      executionWorkspaceCwd: workspaceRoot,
      executionConfig: {
        env: {
          HOME: cursorHome,
        },
      },
    });

    expect(imported).toEqual([]);

    const stored = await db
      .select()
      .from(managedSkills)
      .where(eq(managedSkills.id, existingId))
      .then((rows) => rows[0] ?? null);
    expect(stored?.status).toBe("active");
    expect(stored?.bodyMarkdown).toContain("reviewed body");
    expect(stored?.importedFromRunId).toBeNull();
  });
});

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  sharedContextPublications,
} from "@paperclipai/db";
import { resolveCompanySharedMemoryRoot } from "../home-paths.js";
import { importNativeMemoryFromCompletedRun } from "../services/agent-native-memory.js";
import { sharedContextService } from "../services/shared-context-publications.js";

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
const originalPaperclipHome = process.env.PAPERCLIP_HOME;
const originalPaperclipInstanceId = process.env.PAPERCLIP_INSTANCE_ID;

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-native-memory-"));
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

afterEach(async () => {
  process.env.PAPERCLIP_HOME = originalPaperclipHome;
  process.env.PAPERCLIP_INSTANCE_ID = originalPaperclipInstanceId;

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

describe("importNativeMemoryFromCompletedRun", () => {
  it("imports Hermes native memory into Paperclip shared context and snapshot storage", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);
    const sharedContext = sharedContextService(db);

    const paperclipHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-home-"));
    tempPaths.push(paperclipHome);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "native-memory-test";

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

    const nativeHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-hermes-home-"));
    tempPaths.push(nativeHome);
    const memoriesRoot = path.join(nativeHome, "memories");
    await fs.promises.mkdir(memoriesRoot, { recursive: true });
    await fs.promises.writeFile(path.join(memoriesRoot, "MEMORY.md"), "Prefer compact evidence notes.\n", "utf8");
    await fs.promises.writeFile(path.join(memoriesRoot, "USER.md"), "Dom prefers reviewable commits.\n", "utf8");

    const runId = cryptoRandomUuid();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: company.id,
      agentId: agent.id,
      status: "completed",
      runType: "worker",
      updatedAt: new Date(),
    });

    const imported = await importNativeMemoryFromCompletedRun(db, {
      companyId: company.id,
      agentId: agent.id,
      runId,
      adapterType: "hermes_local",
      executionWorkspaceCwd: "/tmp/unused-workspace",
      executionConfig: {
        env: {
          HERMES_HOME: nativeHome,
        },
      },
    });

    expect(imported).toHaveLength(2);
    expect(imported.map((entry) => entry.kind).sort()).toEqual(["memory", "user"]);

    const snapshotRoot = path.join(resolveCompanySharedMemoryRoot(company.id), agent.id, "hermes");
    expect(await fs.promises.readFile(path.join(snapshotRoot, "MEMORY.md"), "utf8")).toContain("Prefer compact evidence notes.");
    expect(await fs.promises.readFile(path.join(snapshotRoot, "USER.md"), "utf8")).toContain("Dom prefers reviewable commits.");

    const stored = await db
      .select()
      .from(sharedContextPublications)
      .where(eq(sharedContextPublications.companyId, company.id));
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.visibility === "company")).toBe(true);
    expect(stored.every((row) => row.status === "published")).toBe(true);
    expect(stored.every((row) => row.sourceAgentId === agent.id)).toBe(true);

    const runtimeSnippets = await sharedContext.listRuntimeMemorySnippets({
      companyId: company.id,
      agentId: agent.id,
      projectId: null,
      issueId: null,
      limit: 8,
    });
    expect(runtimeSnippets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "company",
          source: "shared_context.company",
          content: expect.stringContaining("Prefer compact evidence notes."),
        }),
        expect.objectContaining({
          scope: "company",
          source: "shared_context.company",
          content: expect.stringContaining("Dom prefers reviewable commits."),
        }),
      ]),
    );
  });

  it("refreshes an imported Hermes memory publication when the native file changes", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);

    const paperclipHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-home-"));
    tempPaths.push(paperclipHome);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "native-memory-refresh";

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

    const nativeHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-hermes-home-"));
    tempPaths.push(nativeHome);
    const memoriesRoot = path.join(nativeHome, "memories");
    await fs.promises.mkdir(memoriesRoot, { recursive: true });
    const memoryPath = path.join(memoriesRoot, "MEMORY.md");
    await fs.promises.writeFile(memoryPath, "Initial memory note.\n", "utf8");

    const firstRunId = cryptoRandomUuid();
    await db.insert(heartbeatRuns).values({
      id: firstRunId,
      companyId: company.id,
      agentId: agent.id,
      status: "completed",
      runType: "worker",
      updatedAt: new Date(),
    });

    const firstImported = await importNativeMemoryFromCompletedRun(db, {
      companyId: company.id,
      agentId: agent.id,
      runId: firstRunId,
      adapterType: "hermes_local",
      executionWorkspaceCwd: "/tmp/unused-workspace",
      executionConfig: { env: { HERMES_HOME: nativeHome } },
    });
    expect(firstImported).toHaveLength(1);

    await fs.promises.writeFile(memoryPath, "Updated memory note.\n", "utf8");
    const secondRunId = cryptoRandomUuid();
    await db.insert(heartbeatRuns).values({
      id: secondRunId,
      companyId: company.id,
      agentId: agent.id,
      status: "completed",
      runType: "worker",
      updatedAt: new Date(),
    });

    const secondImported = await importNativeMemoryFromCompletedRun(db, {
      companyId: company.id,
      agentId: agent.id,
      runId: secondRunId,
      adapterType: "hermes_local",
      executionWorkspaceCwd: "/tmp/unused-workspace",
      executionConfig: { env: { HERMES_HOME: nativeHome } },
    });
    expect(secondImported).toHaveLength(1);
    expect(secondImported[0]?.id).toBe(firstImported[0]?.id);

    const stored = await db
      .select()
      .from(sharedContextPublications)
      .where(eq(sharedContextPublications.id, firstImported[0]!.id))
      .then((rows) => rows[0] ?? null);
    expect(stored?.body).toBe("Updated memory note.");
    expect(stored?.provenance).toEqual(
      expect.objectContaining({
        type: "native_memory_import",
        adapterType: "hermes_local",
        kind: "memory",
        sourcePath: memoryPath,
        importedByRunId: secondRunId,
      }),
    );
  });
});

function cryptoRandomUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

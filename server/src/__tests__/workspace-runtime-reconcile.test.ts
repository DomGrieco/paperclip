import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  workspaceRuntimeServices,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { reconcilePersistedRuntimeServicesOnStartup } from "../services/workspace-runtime.ts";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-runtime-reconcile-"));
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

describe("reconcilePersistedRuntimeServicesOnStartup", () => {
  it("stops stale agent_container runtime services alongside local and Hermes containers", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Paperclip",
      issuePrefix: "PAP",
    }).returning();

    const now = new Date("2026-04-01T00:00:00.000Z");
    await db.insert(workspaceRuntimeServices).values([
      {
        id: "00000000-0000-4000-8000-000000000101",
        companyId: company.id,
        scopeType: "run",
        scopeId: "run-local",
        serviceName: "local-preview",
        status: "starting",
        lifecycle: "ephemeral",
        provider: "local_process",
        healthStatus: "healthy",
        lastUsedAt: now,
        startedAt: now,
        updatedAt: now,
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        companyId: company.id,
        scopeType: "run",
        scopeId: "run-hermes",
        serviceName: "hermes-worker",
        status: "running",
        lifecycle: "ephemeral",
        provider: "hermes_container",
        providerRef: "container-hermes",
        healthStatus: "healthy",
        lastUsedAt: now,
        startedAt: now,
        updatedAt: now,
      },
      {
        id: "00000000-0000-4000-8000-000000000103",
        companyId: company.id,
        scopeType: "run",
        scopeId: "run-agent",
        serviceName: "codex-worker",
        status: "starting",
        lifecycle: "ephemeral",
        provider: "agent_container",
        providerRef: "container-codex",
        healthStatus: "healthy",
        lastUsedAt: now,
        startedAt: now,
        updatedAt: now,
      },
      {
        id: "00000000-0000-4000-8000-000000000104",
        companyId: company.id,
        scopeType: "run",
        scopeId: "run-adapter",
        serviceName: "preview",
        status: "running",
        lifecycle: "ephemeral",
        provider: "adapter_managed",
        providerRef: "sandbox-1",
        healthStatus: "healthy",
        lastUsedAt: now,
        startedAt: now,
        updatedAt: now,
      },
    ]);

    const removedContainerIds: string[] = [];
    const result = await reconcilePersistedRuntimeServicesOnStartup(db, {
      removeContainer: async (containerId) => {
        removedContainerIds.push(containerId);
      },
    });
    expect(result).toEqual({ reconciled: 3 });
    expect(removedContainerIds).toEqual(["container-hermes", "container-codex"]);

    const local = await db.query.workspaceRuntimeServices.findFirst({
      where: eq(workspaceRuntimeServices.id, "00000000-0000-4000-8000-000000000101"),
    });
    const hermes = await db.query.workspaceRuntimeServices.findFirst({
      where: eq(workspaceRuntimeServices.id, "00000000-0000-4000-8000-000000000102"),
    });
    const agent = await db.query.workspaceRuntimeServices.findFirst({
      where: eq(workspaceRuntimeServices.id, "00000000-0000-4000-8000-000000000103"),
    });
    const adapterManaged = await db.query.workspaceRuntimeServices.findFirst({
      where: eq(workspaceRuntimeServices.id, "00000000-0000-4000-8000-000000000104"),
    });

    for (const row of [local, hermes, agent]) {
      expect(row?.status).toBe("stopped");
      expect(row?.healthStatus).toBe("unknown");
      expect(row?.stoppedAt).not.toBeNull();
    }

    expect(adapterManaged?.status).toBe("running");
    expect(adapterManaged?.healthStatus).toBe("healthy");
    expect(adapterManaged?.stoppedAt).toBeNull();
  });

  it("marks stale container-backed runtime services unhealthy when startup cleanup fails", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({
      id: "00000000-0000-4000-8000-000000000011",
      name: "Paperclip",
      issuePrefix: "PAP",
    }).returning();

    const now = new Date("2026-04-01T00:00:00.000Z");
    await db.insert(workspaceRuntimeServices).values({
      id: "00000000-0000-4000-8000-000000000203",
      companyId: company.id,
      scopeType: "run",
      scopeId: "run-agent",
      serviceName: "codex-worker",
      status: "running",
      lifecycle: "ephemeral",
      provider: "agent_container",
      providerRef: "container-codex",
      healthStatus: "healthy",
      lastUsedAt: now,
      startedAt: now,
      updatedAt: now,
    });

    const result = await reconcilePersistedRuntimeServicesOnStartup(db, {
      removeContainer: async () => {
        throw new Error("docker remove failed");
      },
    });
    expect(result).toEqual({ reconciled: 1 });

    const agent = await db.query.workspaceRuntimeServices.findFirst({
      where: eq(workspaceRuntimeServices.id, "00000000-0000-4000-8000-000000000203"),
    });

    expect(agent?.status).toBe("stopped");
    expect(agent?.healthStatus).toBe("unhealthy");
    expect(agent?.stoppedAt).not.toBeNull();
  });
});

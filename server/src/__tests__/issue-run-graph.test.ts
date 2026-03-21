import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
} from "@paperclipai/db";
import type { HeartbeatRun } from "@paperclipai/shared";

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
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-run-graph-"));
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

describe("run graph schema contract", () => {
  it("persists planner/worker/verification graph metadata on runs", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Planner",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();

    async function createRunFixture(input: {
      runType: "planner" | "worker" | "verification";
      rootRunId: string | null;
      parentRunId: string | null;
    }): Promise<HeartbeatRun> {
      const [inserted] = await db.insert(heartbeatRuns).values({
        companyId: company.id,
        agentId: agent.id,
        status: "queued",
        invocationSource: "on_demand",
        runType: input.runType,
        rootRunId: input.rootRunId,
        parentRunId: input.parentRunId,
        graphDepth: input.parentRunId ? 1 : 0,
        repairAttempt: 0,
      }).returning();

      const [run] = await db.update(heartbeatRuns).set({
        rootRunId: inserted.rootRunId ?? inserted.id,
      }).where(eq(heartbeatRuns.id, inserted.id)).returning();

      return run;
    }

    const run = await createRunFixture({
      runType: "planner",
      rootRunId: null,
      parentRunId: null,
    });

    expect(run.runType).toBe("planner");
    expect(run.rootRunId).toBe(run.id);
    expect(run.verificationVerdict).toBeNull();
  }, 20_000);
});

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
  issues,
  heartbeatRuns,
} from "@paperclipai/db";
import type { HeartbeatRun } from "@paperclipai/shared";
import { issueRunGraphService } from "../services/issue-run-graph.js";

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

  it("creates a planner root and bounded worker children for an issue", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);

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
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Build run graph",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const root = await graph.startPlannerRoot(issue.id, agent.id);
    const children = await graph.spawnWorkers(root.id, [
      { taskKey: "worker-a" },
      { taskKey: "worker-b" },
    ]);

    expect(root.runType).toBe("planner");
    expect(root.status).toBe("queued");
    expect(root.parentRunId).toBeNull();
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.parentRunId === root.id)).toBe(true);
  }, 20_000);

  it("queues a repair worker when verification returns repair and retries remain", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [plannerAgent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Planner",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [workerAgent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Worker",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Repair loop issue",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: workerAgent.id,
    }).returning();

    async function createPlannerRoot(issueId: string) {
      return graph.startPlannerRoot(issueId, plannerAgent.id);
    }

    async function createWorkerChild(parentRunId: string, input?: { repairAttempt?: number }) {
      const [worker] = await db.insert(heartbeatRuns).values({
        companyId: company.id,
        agentId: workerAgent.id,
        status: "succeeded",
        invocationSource: "assignment",
        triggerDetail: "system",
        runType: "worker",
        rootRunId: parentRunId,
        parentRunId,
        graphDepth: 1,
        repairAttempt: input?.repairAttempt ?? 0,
        contextSnapshot: {
          issueId: issue.id,
          taskKey: "worker-a",
        },
      }).returning();

      return worker;
    }

    async function verifyWorker(workerRunId: string, input: { verdict: "repair" | "pass" | "fail_terminal" }) {
      const [verification] = await db.insert(heartbeatRuns).values({
        companyId: company.id,
        agentId: plannerAgent.id,
        status: "succeeded",
        invocationSource: "assignment",
        triggerDetail: "system",
        runType: "verification",
        rootRunId: (await db.select({ rootRunId: heartbeatRuns.rootRunId }).from(heartbeatRuns).where(eq(heartbeatRuns.id, workerRunId)).then((rows) => rows[0]))?.rootRunId ?? null,
        parentRunId: workerRunId,
        graphDepth: 2,
        repairAttempt: input.verdict === "repair" ? 1 : 0,
        verificationVerdict: input.verdict,
        contextSnapshot: {
          issueId: issue.id,
        },
      }).returning();

      return verification;
    }

    const planner = await createPlannerRoot(issue.id);
    const worker = await createWorkerChild(planner.id, { repairAttempt: 0 });
    const verification = await verifyWorker(worker.id, { verdict: "repair" });

    const retryWorker = await graph.scheduleRepairFromVerification(verification.id);
    expect(retryWorker.repairAttempt).toBe(1);
    expect(retryWorker.parentRunId).toBe(planner.id);
  }, 20_000);

  it("does not queue duplicate repair workers for the same verification run", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [plannerAgent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Planner",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [workerAgent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Worker",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Repair idempotency issue",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: workerAgent.id,
    }).returning();

    const planner = await graph.startPlannerRoot(issue.id, plannerAgent.id);
    const [worker] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: workerAgent.id,
      status: "succeeded",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "worker",
      rootRunId: planner.id,
      parentRunId: planner.id,
      graphDepth: 1,
      repairAttempt: 0,
      contextSnapshot: {
        issueId: issue.id,
        taskKey: "worker-a",
      },
    }).returning();
    const [verification] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: plannerAgent.id,
      status: "succeeded",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "verification",
      rootRunId: planner.id,
      parentRunId: worker.id,
      graphDepth: 2,
      repairAttempt: 1,
      verificationVerdict: "repair",
      contextSnapshot: {
        issueId: issue.id,
      },
    }).returning();

    const firstRetry = await graph.scheduleRepairFromVerification(verification.id);
    const secondRetry = await graph.scheduleRepairFromVerification(verification.id);
    const retries = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.parentRunId, planner.id));

    expect(firstRetry?.id).toBe(secondRetry?.id);
    expect(retries.filter((run) => run.contextSnapshot?.verificationRunId === verification.id)).toHaveLength(1);
  }, 20_000);

  it("stops scheduling repair workers after the default retry limit is reached", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [plannerAgent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Planner",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [workerAgent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Worker",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Repair loop limit issue",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: workerAgent.id,
    }).returning();

    const planner = await graph.startPlannerRoot(issue.id, plannerAgent.id);
    const [worker] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: workerAgent.id,
      status: "succeeded",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "worker",
      rootRunId: planner.id,
      parentRunId: planner.id,
      graphDepth: 1,
      repairAttempt: 3,
      contextSnapshot: {
        issueId: issue.id,
        taskKey: "worker-a",
      },
    }).returning();

    const [verification] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: plannerAgent.id,
      status: "succeeded",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "verification",
      rootRunId: planner.id,
      parentRunId: worker.id,
      graphDepth: 2,
      repairAttempt: 3,
      verificationVerdict: "repair",
      contextSnapshot: {
        issueId: issue.id,
      },
    }).returning();

    const retryWorker = await graph.scheduleRepairFromVerification(verification.id);
    const workers = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.runType, "worker"));

    expect(retryWorker).toBeNull();
    expect(workers).toHaveLength(1);
  }, 20_000);

  it("rebuilds the persisted graph after a runner-lost worker failure", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Worker",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Recover run graph after restart",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const planner = await graph.startPlannerRoot(issue.id, agent.id);
    await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "failed",
      errorCode: "runner_lost",
      error: "Runner process disappeared before completion",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "worker",
      rootRunId: planner.id,
      parentRunId: planner.id,
      graphDepth: 1,
      repairAttempt: 0,
      contextSnapshot: {
        issueId: issue.id,
        taskKey: "worker-a",
      },
    });

    const recovered = issueRunGraphService(db);
    const summary = await recovered.getIssueSummary(issue.id);

    expect(summary.rootRunId).toBe(planner.id);
    expect(summary.nodes).toEqual([
      expect.objectContaining({
        id: planner.id,
        runType: "planner",
        status: "queued",
      }),
      expect.objectContaining({
        runType: "worker",
        status: "failed",
        parentRunId: planner.id,
        rootRunId: planner.id,
      }),
    ]);
  }, 20_000);
});

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import { heartbeatService } from "../services/heartbeat.js";
import { issueRunGraphService } from "../services/issue-run-graph.js";
import { shouldWakeAssigneeOnCheckout } from "../routes/issues-checkout-wakeup.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-checkout-wakeup-"));
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

describe("shouldWakeAssigneeOnCheckout", () => {
  it("keeps wakeup behavior for board actors", () => {
    expect(
      shouldWakeAssigneeOnCheckout({
        actorType: "board",
        actorAgentId: null,
        checkoutAgentId: "agent-1",
        checkoutRunId: null,
      }),
    ).toBe(true);
  });

  it("skips wakeup for agent self-checkout in an active run", () => {
    expect(
      shouldWakeAssigneeOnCheckout({
        actorType: "agent",
        actorAgentId: "agent-1",
        checkoutAgentId: "agent-1",
        checkoutRunId: "run-1",
      }),
    ).toBe(false);
  });

  it("still wakes when checkout run id is missing", () => {
    expect(
      shouldWakeAssigneeOnCheckout({
        actorType: "agent",
        actorAgentId: "agent-1",
        checkoutAgentId: "agent-1",
        checkoutRunId: null,
      }),
    ).toBe(true);
  });

  it("still wakes when agent checks out on behalf of another agent id", () => {
    expect(
      shouldWakeAssigneeOnCheckout({
        actorType: "agent",
        actorAgentId: "agent-1",
        checkoutAgentId: "agent-2",
        checkoutRunId: "run-1",
      }),
    ).toBe(true);
  });
});

describe("issue checkout wakeups", () => {
  it("reuses the planner root when checkout wakeups queue planner runs", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const heartbeat = heartbeatService(db);
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
      title: "Investigate checkout wakeups",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const root = await graph.startPlannerRoot(issue.id, agent.id);
    const run = await heartbeat.wakeup(agent.id, {
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_checked_out",
      payload: { issueId: issue.id, mutation: "checkout" },
      contextSnapshot: { issueId: issue.id, source: "issue.checkout" },
    });

    expect(run).not.toBeNull();
    expect(run?.runType).toBe("planner");
    expect(run?.rootRunId).toBe(root.id);
    expect(run?.parentRunId).toBeNull();

    const wakeup = await db
      .select()
      .from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.agentId, agent.id), eq(agentWakeupRequests.runId, run?.id ?? "")))
      .then((rows) => rows[0] ?? null);

    expect(wakeup?.rootRunId).toBe(root.id);
    expect(wakeup?.parentRunId).toBeNull();
    expect(wakeup?.targetRunType).toBe("planner");
  }, 20_000);

  it("does not persist a planner root when wakeup agent validation fails", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const heartbeat = heartbeatService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Do not create orphan planner roots",
      status: "in_progress",
      priority: "high",
    }).returning();

    await expect(
      heartbeat.wakeup("00000000-0000-0000-0000-000000000000", {
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_checked_out",
        payload: { issueId: issue.id, mutation: "checkout" },
        contextSnapshot: { issueId: issue.id, source: "issue.checkout" },
      }),
    ).rejects.toThrow("Agent not found");

    const plannerRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.companyId, company.id));

    expect(plannerRuns).toHaveLength(0);
  }, 20_000);
});

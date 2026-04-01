import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";

const adapterMocks = vi.hoisted(() => {
  const execute = vi.fn();
  const getServerAdapter = vi.fn(() => ({
    type: "fake_verifier",
    execute,
    testEnvironment: vi.fn(async () => ({
      adapterType: "fake_verifier",
      status: "pass",
      checks: [],
      testedAt: new Date().toISOString(),
    })),
    supportsLocalAgentJwt: false,
  }));
  return {
    execute,
    getServerAdapter,
    runningProcesses: new Map<string, unknown>(),
  };
});

vi.mock("../adapters/index.js", () => ({
  getServerAdapter: adapterMocks.getServerAdapter,
  runningProcesses: adapterMocks.runningProcesses,
}));

import { heartbeatService } from "../services/heartbeat.js";
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-heartbeat-verification-"));
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

async function waitForRunTerminalState(db: ReturnType<typeof createDb>, runId: string) {
  for (let i = 0; i < 100; i += 1) {
    const run = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((rows) => rows[0] ?? null);
    if (run && run.status !== "queued" && run.status !== "running") return run;
    await delay(50);
  }
  throw new Error("Timed out waiting for queued verification run to finish");
}

async function waitForAgentHeartbeatStart(db: ReturnType<typeof createDb>, agentId: string) {
  for (let i = 0; i < 100; i += 1) {
    const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((rows) => rows[0] ?? null);
    if (agent && agent.status === "running" && agent.lastHeartbeatAt) return agent;
    await delay(50);
  }
  throw new Error("Timed out waiting for agent heartbeat start state");
}

afterEach(async () => {
  adapterMocks.execute.mockReset();
  adapterMocks.getServerAdapter.mockClear();
  adapterMocks.runningProcesses.clear();

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

describe("heartbeat verification output ingestion", () => {
  it("updates lastHeartbeatAt as soon as a run starts", async () => {
    let releaseExecution: (() => void) | null = null;
    adapterMocks.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseExecution = () => {
            resolve({
              exitCode: 0,
              signal: null,
              timedOut: false,
            });
          };
        }),
    );

    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const heartbeat = heartbeatService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Verifier",
      role: "qa",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();

    const run = await heartbeat.wakeup(agent.id, {
      source: "on_demand",
      triggerDetail: "manual",
      contextSnapshot: { source: "test" },
    });

    expect(run).not.toBeNull();
    const runningAgent = await waitForAgentHeartbeatStart(db, agent.id);
    const runningRun = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)).then((rows) => rows[0] ?? null);

    expect(runningAgent.status).toBe("running");
    expect(runningAgent.lastHeartbeatAt).not.toBeNull();
    expect(runningRun?.startedAt).not.toBeNull();
    expect(new Date(runningAgent.lastHeartbeatAt!).toISOString()).toBe(
      new Date(runningRun!.startedAt!).toISOString(),
    );

    const startedActivity = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, run!.id))
      .then((rows) => rows.find((row) => row.action === "heartbeat.started") ?? null);
    expect(startedActivity).toEqual(
      expect.objectContaining({
        entityType: "heartbeat_run",
        entityId: run!.id,
        action: "heartbeat.started",
        details: { agentId: agent.id },
      }),
    );

    releaseExecution?.();
    const finalized = await waitForRunTerminalState(db, run!.id);
    expect(finalized.status).toBe("succeeded");
  }, 20_000);

  it("aligns assignment-backed planner start timing with agent heartbeat state", async () => {
    let releaseExecution: (() => void) | null = null;
    adapterMocks.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseExecution = () => {
            resolve({
              exitCode: 0,
              signal: null,
              timedOut: false,
            });
          };
        }),
    );

    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const heartbeat = heartbeatService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Hermes CEO",
      role: "ceo",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Planner start observability",
      status: "todo",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const run = await heartbeat.wakeup(agent.id, {
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId: issue.id, mutation: "update" },
      contextSnapshot: {
        source: "issue.update",
        issueId: issue.id,
        wakeReason: "issue_assigned",
      },
    });

    expect(run).not.toBeNull();
    expect(run?.runType).toBe("planner");
    expect(run?.rootRunId).toBe(run?.id);
    expect(run?.parentRunId).toBeNull();

    await heartbeat.resumeQueuedRuns();

    const runningAgent = await waitForAgentHeartbeatStart(db, agent.id);
    const runningRun = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)).then((rows) => rows[0] ?? null);

    expect(runningAgent.status).toBe("running");
    expect(runningRun?.status).toBe("running");
    expect(runningRun?.runType).toBe("planner");
    expect(runningRun?.startedAt).not.toBeNull();
    expect(runningRun?.contextSnapshot).toEqual(
      expect.objectContaining({
        issueId: issue.id,
        wakeReason: "issue_assigned",
      }),
    );
    expect(new Date(runningAgent.lastHeartbeatAt!).toISOString()).toBe(
      new Date(runningRun!.startedAt!).toISOString(),
    );

    releaseExecution?.();
    const finalized = await waitForRunTerminalState(db, run!.id);
    expect(finalized.status).toBe("succeeded");
  }, 20_000);

  it("fans out worker children from planner-produced swarm plans", async () => {
    adapterMocks.execute.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      resultJson: {
        swarmPlan: {
          version: "v1",
          rationale: "Split implementation and verification.",
          subtasks: [
            {
              id: "worker-heartbeat-ui",
              kind: "implementation",
              title: "Update heartbeat UI labels",
              goal: "Render request/start states distinctly in the issue timeline.",
              taskKey: "heartbeat-ui",
              allowedPaths: ["ui/src/components/ActivityRow.tsx"],
              ownershipMode: "exclusive",
              expectedArtifacts: [{ kind: "patch", required: true }],
              acceptanceChecks: ["UI shows heartbeat.requested and heartbeat.started distinctly."],
              recommendedModelTier: "balanced",
              budgetCents: 25,
              maxRuntimeSec: 900,
            },
            {
              id: "verify-heartbeat-ui",
              kind: "verification",
              title: "Verify heartbeat UI labels",
              goal: "Verify the updated timeline labels in a browser check.",
              taskKey: "verify-heartbeat-ui",
              expectedArtifacts: [{ kind: "test_result", required: true }],
              acceptanceChecks: ["Browser validation confirms distinct request/start labels."],
              recommendedModelTier: "premium",
              budgetCents: 20,
              maxRuntimeSec: 600,
              dependsOn: ["worker-heartbeat-ui"],
            },
          ],
        },
      },
    });

    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const heartbeat = heartbeatService(db);
    const graph = issueRunGraphService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Hermes CEO",
      role: "ceo",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Planner fan-out ingestion",
      status: "todo",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const run = await heartbeat.wakeup(agent.id, {
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId: issue.id, mutation: "update" },
      contextSnapshot: {
        source: "issue.update",
        issueId: issue.id,
        wakeReason: "issue_assigned",
      },
    });

    expect(run).not.toBeNull();
    expect(run?.runType).toBe("planner");

    await heartbeat.resumeQueuedRuns();
    const finalized = await waitForRunTerminalState(db, run!.id);
    const children = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.parentRunId, run!.id));
    const summary = await graph.getIssueSummary(issue.id);

    expect(finalized.status).toBe("succeeded");
    expect(finalized.contextSnapshot).toEqual(
      expect.objectContaining({
        swarmPlan: expect.objectContaining({
          version: "v1",
          plannerRunId: run!.id,
        }),
        swarmAdmission: expect.objectContaining({
          admitted: true,
          subtaskCount: 2,
        }),
      }),
    );
    expect(children).toHaveLength(2);
    expect(children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runType: "worker",
          rootRunId: run!.id,
          parentRunId: run!.id,
          policySnapshotJson: expect.objectContaining({
            swarmPlannerRunId: run!.id,
            swarmSubtaskId: "worker-heartbeat-ui",
          }),
          contextSnapshot: expect.objectContaining({
            issueId: issue.id,
            taskKey: "heartbeat-ui",
            swarmSubtaskId: "worker-heartbeat-ui",
            swarmModelTier: "balanced",
          }),
        }),
        expect.objectContaining({
          runType: "worker",
          rootRunId: run!.id,
          parentRunId: run!.id,
          policySnapshotJson: expect.objectContaining({
            swarmPlannerRunId: run!.id,
            swarmSubtaskId: "verify-heartbeat-ui",
          }),
          contextSnapshot: expect.objectContaining({
            issueId: issue.id,
            taskKey: "verify-heartbeat-ui",
            swarmSubtaskId: "verify-heartbeat-ui",
            swarmModelTier: "premium",
          }),
        }),
      ]),
    );
    expect(summary.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: run!.id, runType: "planner", status: "succeeded" }),
        expect.objectContaining({ runType: "worker", parentRunId: run!.id }),
      ]),
    );
  }, 20_000);

  it("captures hermes-container runtime services for assignment-backed planner runs", async () => {
    adapterMocks.execute.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      runtimeServices: [
        {
          serviceName: "hermes-worker",
          provider: "hermes_container",
          providerRef: "container-123",
          scopeType: "run",
          scopeId: "run-placeholder",
          url: "http://hermes-worker.internal",
        },
      ],
    });

    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const heartbeat = heartbeatService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Hermes CEO",
      role: "ceo",
      adapterType: "hermes_local",
      adapterConfig: {
        hermesCommand: "/tmp/test-hermes",
      },
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Hermes planner runtime services",
      status: "todo",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const run = await heartbeat.wakeup(agent.id, {
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId: issue.id, mutation: "update" },
      contextSnapshot: {
        source: "issue.update",
        issueId: issue.id,
        wakeReason: "issue_assigned",
      },
    });

    expect(run).not.toBeNull();
    expect(run?.runType).toBe("planner");

    await heartbeat.resumeQueuedRuns();
    const finalized = await waitForRunTerminalState(db, run!.id);
    const runtimeServices = Array.isArray(finalized.contextSnapshot?.paperclipRuntimeServices)
      ? finalized.contextSnapshot.paperclipRuntimeServices
      : [];

    expect(finalized.status).toBe("succeeded");
    expect(finalized.runnerSnapshotJson).toEqual({
      target: "hermes_container",
      provider: "hermes_container",
      workspaceStrategyType: null,
      executionMode: null,
      browserCapable: true,
      sandboxed: true,
      isolationBoundary: "container_process",
    });
    expect(finalized.contextSnapshot).toEqual(
      expect.objectContaining({
        issueId: issue.id,
        wakeReason: "issue_assigned",
        paperclipRuntimePrimaryUrl: "http://hermes-worker.internal",
      }),
    );
    expect(runtimeServices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "hermes_container",
          providerRef: "container-123",
          serviceName: "hermes-worker",
          scopeType: "run",
          scopeId: "run-placeholder",
          startedByRunId: finalized.id,
          ownerAgentId: agent.id,
          url: "http://hermes-worker.internal",
        }),
      ]),
    );
  }, 20_000);

  it("persists adapter-reported verification verdicts and syncs the issue evidence bundle", async () => {
    adapterMocks.execute.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      verificationVerdict: "pass",
      resultJson: {
        evaluatorSummary: "Verification passed through the adapter execution path.",
      },
      artifacts: [
        {
          artifactKind: "screenshot",
          role: "review",
          label: "verification-final",
          metadata: { path: "artifacts/verification-final.png" },
        },
      ],
    });

    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const heartbeat = heartbeatService(db);
    const graph = issueRunGraphService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Verifier",
      role: "qa",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Verification output ingestion",
      status: "in_review",
      priority: "high",
      assigneeAgentId: agent.id,
      evidencePolicy: "code_ci_evaluator_summary_artifacts",
      evidencePolicySource: "issue_override",
    }).returning();

    const planner = await graph.startPlannerRoot(issue.id, agent.id);
    const [worker] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "succeeded",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "worker",
      rootRunId: planner.id,
      parentRunId: planner.id,
      graphDepth: 1,
      repairAttempt: 0,
      contextSnapshot: { issueId: issue.id },
    }).returning();
    const [verification] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "queued",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "verification",
      rootRunId: planner.id,
      parentRunId: worker.id,
      graphDepth: 2,
      repairAttempt: 0,
      contextSnapshot: { issueId: issue.id },
    }).returning();

    await heartbeat.resumeQueuedRuns();
    const finalized = await waitForRunTerminalState(db, verification.id);
    const summary = await graph.getIssueSummary(issue.id);
    const reloadedIssue = await db.select().from(issues).where(eq(issues.id, issue.id)).then((rows) => rows[0] ?? null);

    expect(finalized.status).toBe("succeeded");
    expect(finalized.verificationVerdict).toBe("pass");
    expect(finalized.runnerSnapshotJson).toEqual({
      target: "cloud_sandbox",
      provider: "cloud_sandbox",
      workspaceStrategyType: null,
      executionMode: null,
      browserCapable: true,
      sandboxed: true,
      isolationBoundary: "cloud_sandbox",
    });
    expect(reloadedIssue?.lastVerificationRunId).toBe(verification.id);
    expect(reloadedIssue?.reviewReadyAt).not.toBeNull();
    expect(summary.evidenceBundle?.bundle).toEqual({
      evaluatorSummary: "Verification passed through the adapter execution path.",
      verdict: "pass",
      artifacts: [
        {
          artifactId: expect.any(String),
          artifactKind: "screenshot",
          role: "review",
          label: "verification-final",
          metadata: { path: "artifacts/verification-final.png" },
        },
      ],
    });
  }, 20_000);
});

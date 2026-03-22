import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
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
      target: "local_host",
      provider: "local_process",
      workspaceStrategyType: null,
      executionMode: null,
      browserCapable: false,
      sandboxed: false,
      isolationBoundary: "host_process",
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

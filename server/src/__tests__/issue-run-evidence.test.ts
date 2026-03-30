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
  heartbeatRunArtifacts,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import { issueRunGraphService } from "../services/issue-run-graph.js";
import { issueRunEvidenceService } from "../services/issue-run-evidence.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-run-evidence-"));
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

describe("issue run evidence", () => {
  it("assembles evaluator summary and artifact references into the issue evidence bundle", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);
    const evidence = issueRunEvidenceService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Verifier",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Evidence bundle issue",
      status: "in_review",
      priority: "high",
      assigneeAgentId: agent.id,
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
      contextSnapshot: {
        issueId: issue.id,
      },
    }).returning();
    const [verification] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "succeeded",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "verification",
      rootRunId: planner.id,
      parentRunId: worker.id,
      graphDepth: 2,
      repairAttempt: 0,
      verificationVerdict: "pass",
      artifactBundleJson: {
        evaluatorSummary: "CI passed and review notes attached.",
      },
      contextSnapshot: {
        issueId: issue.id,
      },
      finishedAt: new Date("2026-03-22T12:00:00.000Z"),
    }).returning();

    await db.insert(heartbeatRunArtifacts).values([
      {
        companyId: company.id,
        runId: verification.id,
        issueId: issue.id,
        artifactKind: "screenshot",
        role: "review",
        label: "before-fix",
        assetId: null,
        documentId: null,
        issueWorkProductId: null,
        metadata: { path: "artifacts/screenshot.png" },
      },
      {
        companyId: company.id,
        runId: verification.id,
        issueId: issue.id,
        artifactKind: "log_bundle",
        role: "ci",
        label: "logs",
        assetId: null,
        documentId: null,
        issueWorkProductId: null,
        metadata: { path: "artifacts/logs.zip" },
      },
    ]);

    const summary = await graph.getIssueSummary(issue.id);

    expect(summary.reviewReadyAt?.toISOString()).toBe("2026-03-22T12:00:00.000Z");
    expect(summary.evidenceBundle).toEqual({
      policy: "code_ci_evaluator_summary",
      policySource: "company_default",
      reviewReadyAt: new Date("2026-03-22T12:00:00.000Z"),
      lastVerificationRunId: verification.id,
      bundle: {
        evaluatorSummary: "CI passed and review notes attached.",
        verdict: "pass",
        artifacts: [
          {
            artifactId: expect.any(String),
            artifactKind: "screenshot",
            role: "review",
            label: "before-fix",
            metadata: { path: "artifacts/screenshot.png" },
          },
          {
            artifactId: expect.any(String),
            artifactKind: "log_bundle",
            role: "ci",
            label: "logs",
            metadata: { path: "artifacts/logs.zip" },
          },
        ],
      },
    });
  }, 20_000);

  it("synthesizes planner reviewer decisions from structured child outputs and accepted artifacts", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);
    const evidence = issueRunEvidenceService(db);

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
      title: "Synthesis issue",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const planner = await graph.startPlannerRoot(issue.id, agent.id);
    const [acceptedWorker, repairWorker, rejectedWorker] = await db.insert(heartbeatRuns).values([
      {
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
        resultJson: {
          childOutput: {
            summary: "Implemented the heartbeat label split.",
            status: "completed",
            artifactClaims: [{ kind: "patch", label: "heartbeat-labels" }],
          },
        },
        contextSnapshot: {
          issueId: issue.id,
          taskKey: "heartbeat-ui",
          swarmSubtask: {
            id: "worker-heartbeat-ui",
            kind: "implementation",
            title: "Update heartbeat UI labels",
            goal: "Render request/start states distinctly.",
            expectedArtifacts: [{ kind: "patch", required: true }],
            acceptanceChecks: ["UI labels distinct"],
            recommendedModelTier: "balanced",
          },
        },
      },
      {
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
        resultJson: {
          childOutput: {
            summary: "Attempted browser verification but found mismatched labels.",
            status: "blocked",
          },
        },
        contextSnapshot: {
          issueId: issue.id,
          taskKey: "verify-heartbeat-ui",
          swarmSubtask: {
            id: "verify-heartbeat-ui",
            kind: "verification",
            title: "Verify heartbeat UI labels",
            goal: "Verify browser results.",
            expectedArtifacts: [{ kind: "test_result", required: true }],
            acceptanceChecks: ["Browser confirms labels"],
            recommendedModelTier: "premium",
          },
        },
      },
      {
        companyId: company.id,
        agentId: agent.id,
        status: "failed",
        invocationSource: "assignment",
        triggerDetail: "system",
        runType: "worker",
        rootRunId: planner.id,
        parentRunId: planner.id,
        graphDepth: 1,
        repairAttempt: 0,
        contextSnapshot: {
          issueId: issue.id,
          taskKey: "cleanup",
          swarmSubtask: {
            id: "cleanup",
            kind: "implementation",
            title: "Cleanup",
            goal: "Cleanup supporting files.",
            expectedArtifacts: [{ kind: "patch", required: true }],
            acceptanceChecks: ["Cleanup complete"],
            recommendedModelTier: "cheap",
          },
        },
      },
    ]).returning();

    await db.insert(heartbeatRunArtifacts).values([
      {
        companyId: company.id,
        runId: acceptedWorker.id,
        issueId: issue.id,
        artifactKind: "patch",
        role: "implementation",
        label: "heartbeat-ui.patch",
        assetId: null,
        documentId: null,
        issueWorkProductId: null,
        metadata: { path: "ui/src/components/ActivityRow.tsx" },
      },
    ]);

    await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "succeeded",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "verification",
      rootRunId: planner.id,
      parentRunId: repairWorker.id,
      graphDepth: 2,
      repairAttempt: 0,
      verificationVerdict: "repair",
      contextSnapshot: { issueId: issue.id },
    });

    const synthesis = await evidence.synthesizePlannerReview(planner.id);
    const plannerReloaded = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, planner.id)).then((rows) => rows[0] ?? null);
    const summary = await graph.getIssueSummary(issue.id);

    expect(synthesis?.synthesis).toEqual(
      expect.objectContaining({
        status: "complete",
        acceptedChildCount: 1,
        requestRepairChildCount: 1,
        rejectedChildCount: 1,
      }),
    );
    expect(plannerReloaded?.artifactBundleJson).toEqual(
      expect.objectContaining({
        evaluatorSummary: expect.stringContaining("Accepted 1 child outputs"),
        reviewerDecisions: expect.arrayContaining([
          expect.objectContaining({ taskKey: "heartbeat-ui", decision: "accept" }),
          expect.objectContaining({ taskKey: "verify-heartbeat-ui", decision: "request_repair" }),
          expect.objectContaining({ taskKey: "cleanup", decision: "reject" }),
        ]),
        artifacts: expect.arrayContaining([
          expect.objectContaining({ artifactKind: "patch", label: "heartbeat-ui.patch" }),
        ]),
      }),
    );
    expect(summary.nodes.find((node) => node.id === planner.id)?.artifactBundleJson).toEqual(
      expect.objectContaining({
        synthesis: expect.objectContaining({ acceptedChildCount: 1 }),
      }),
    );
  }, 20_000);

  it("keeps reviewReadyAt unset when the policy-required evidence is missing", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);
    const evidence = issueRunEvidenceService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Verifier",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Missing evidence issue",
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
      contextSnapshot: {
        issueId: issue.id,
      },
    }).returning();
    const [verification] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "succeeded",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "verification",
      rootRunId: planner.id,
      parentRunId: worker.id,
      graphDepth: 2,
      repairAttempt: 0,
      verificationVerdict: "pass",
      artifactBundleJson: {
        evaluatorSummary: "Looks good, but no human-facing artifact was attached.",
      },
      contextSnapshot: {
        issueId: issue.id,
      },
      finishedAt: new Date("2026-03-22T13:00:00.000Z"),
    }).returning();

    await evidence.syncVerificationOutcome(verification.id);

    const reloadedIssue = await db.select().from(issues).where(eq(issues.id, issue.id)).then((rows) => rows[0] ?? null);
    const summary = await graph.getIssueSummary(issue.id);

    expect(reloadedIssue?.lastVerificationRunId).toBe(verification.id);
    expect(reloadedIssue?.reviewReadyAt).toBeNull();
    expect(summary.reviewReadyAt).toBeNull();
    expect(summary.evidenceBundle).toEqual({
      policy: "code_ci_evaluator_summary_artifacts",
      policySource: "issue_override",
      reviewReadyAt: null,
      lastVerificationRunId: verification.id,
      bundle: {
        evaluatorSummary: "Looks good, but no human-facing artifact was attached.",
        verdict: "pass",
        artifacts: [],
      },
    });
  }, 20_000);

  it("persists adapter-reported artifacts and surfaces them in the synced evidence bundle", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);
    const evidence = issueRunEvidenceService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Verifier",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Artifact ingestion issue",
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
      status: "succeeded",
      invocationSource: "assignment",
      triggerDetail: "system",
      runType: "verification",
      rootRunId: planner.id,
      parentRunId: worker.id,
      graphDepth: 2,
      repairAttempt: 0,
      verificationVerdict: "pass",
      resultJson: { evaluatorSummary: "Artifacts were uploaded by the runner." },
      contextSnapshot: { issueId: issue.id },
      finishedAt: new Date("2026-03-22T14:00:00.000Z"),
    }).returning();

    await evidence.persistReportedRunArtifacts({
      companyId: company.id,
      runId: verification.id,
      issueId: issue.id,
      artifacts: [
        {
          artifactKind: "browser_recording",
          role: "review",
          label: "walkthrough",
          metadata: { path: "artifacts/review.mp4" },
        },
        {
          artifactKind: "screenshot",
          role: "review",
          label: "final-state",
          metadata: { path: "artifacts/final.png" },
        },
      ],
    });

    await evidence.syncVerificationOutcome(verification.id);

    const summary = await graph.getIssueSummary(issue.id);

    expect(summary.reviewReadyAt?.toISOString()).toBe("2026-03-22T14:00:00.000Z");
    expect(summary.evidenceBundle).toEqual({
      policy: "code_ci_evaluator_summary_artifacts",
      policySource: "issue_override",
      reviewReadyAt: new Date("2026-03-22T14:00:00.000Z"),
      lastVerificationRunId: verification.id,
      bundle: {
        evaluatorSummary: "Artifacts were uploaded by the runner.",
        verdict: "pass",
        artifacts: [
          {
            artifactId: expect.any(String),
            artifactKind: "screenshot",
            role: "review",
            label: "final-state",
            metadata: { path: "artifacts/final.png" },
          },
          {
            artifactId: expect.any(String),
            artifactKind: "browser_recording",
            role: "review",
            label: "walkthrough",
            metadata: { path: "artifacts/review.mp4" },
          },
        ],
      },
    });
  }, 20_000);

  it("materializes structured child-output artifact claims into heartbeat run artifacts for planner review", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);
    const graph = issueRunGraphService(db);
    const evidence = issueRunEvidenceService(db);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Verifier",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Structured child artifacts",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
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
      resultJson: {
        childOutput: {
          summary: "Validated structured artifact persistence.",
          status: "completed",
          artifactClaims: [
            { kind: "comment", label: "validation-comment", detail: "Issue comment with concrete evidence." },
            { kind: "test_result", label: "validation-test", detail: "Observed accepted child output." },
          ],
        },
      },
      contextSnapshot: {
        issueId: issue.id,
        taskKey: "structured-artifact-check",
        swarmSubtask: {
          id: "structured-artifact-check",
          kind: "verification",
          title: "Check structured child artifacts",
          goal: "Persist artifact claims for planner review.",
          expectedArtifacts: [
            { kind: "comment", required: true },
            { kind: "test_result", required: true },
          ],
          acceptanceChecks: ["Planner accepts the worker child output"],
          recommendedModelTier: "balanced",
        },
      },
    }).returning();

    const synthesis = await evidence.synthesizePlannerReview(planner.id);
    const artifacts = await db
      .select()
      .from(heartbeatRunArtifacts)
      .where(eq(heartbeatRunArtifacts.runId, worker.id));

    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: "comment",
          label: "validation-comment",
          role: "verification",
          metadata: expect.objectContaining({ source: "structured_child_output_claim" }),
        }),
        expect.objectContaining({
          artifactKind: "test_result",
          label: "validation-test",
          role: "verification",
          metadata: expect.objectContaining({ source: "structured_child_output_claim" }),
        }),
      ]),
    );
    expect(synthesis?.reviewerDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskKey: "structured-artifact-check",
          decision: "accept",
          reasons: ["accepted"],
        }),
      ]),
    );
  }, 20_000);

});

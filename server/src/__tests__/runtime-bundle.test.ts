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
  issues,
  projects,
  heartbeatRuns,
  sharedContextPublications,
} from "@paperclipai/db";
import { issueRunGraphService } from "../services/issue-run-graph.js";
import { resolveRuntimeBundle } from "../services/runtime-bundle.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-runtime-bundle-"));
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

describe("resolveRuntimeBundle", () => {
  it("resolves task, project, policy, and memory recall into a worker startup bundle", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST", description: "Run the company as a disciplined autonomous software team." }).returning();
    const [project] = await db.insert(projects).values({
      companyId: company.id,
      name: "Runtime Bundle Project",
      description: "Project context should be present in the recall packet.",
      status: "in_progress",
      executionWorkspacePolicy: {
        defaultMode: "isolated_workspace",
        workspaceStrategy: { type: "git_worktree" },
      },
    }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      projectId: project.id,
      name: "Worker",
      role: "engineer",
      capabilities: "Ship code with tests and clear handoffs.",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      projectId: project.id,
      title: "Build runtime bundle",
      description: "Remember the issue operating context.",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const bundle = await resolveRuntimeBundle(db, {
      companyId: company.id,
      issueId: issue.id,
      agentId: agent.id,
      runId: null,
      runtime: "codex",
    });

    expect(bundle.issue?.id).toBe(issue.id);
    expect(bundle.project?.id).toBe(project.id);
    expect(bundle.policy).toEqual({
      tddMode: "required",
      evidencePolicy: "code_ci_evaluator_summary",
      evidencePolicySource: "company_default",
      maxRepairAttempts: 3,
      requiresHumanArtifacts: false,
    });
    expect(bundle.run).toEqual({
      id: null,
      runType: null,
      rootRunId: null,
      parentRunId: null,
      graphDepth: null,
      repairAttempt: 0,
      verificationVerdict: null,
    });
    expect(bundle.runner).toEqual({
      target: "local_host",
      provider: "local_process",
      workspaceStrategyType: "git_worktree",
      executionMode: "isolated_workspace",
      browserCapable: false,
      sandboxed: false,
      isolationBoundary: "host_process",
    });
    expect(bundle.memory.snippets).toEqual([
      {
        scope: "company",
        source: "company.description",
        sourceId: company.id,
        content: "Run the company as a disciplined autonomous software team.",
        freshness: "static",
        updatedAt: expect.any(String),
        rank: 1,
      },
      {
        scope: "project",
        source: "project.description",
        sourceId: project.id,
        content: "Project context should be present in the recall packet.",
        freshness: "static",
        updatedAt: expect.any(String),
        rank: 2,
      },
      {
        scope: "issue",
        source: "issue.description",
        sourceId: issue.id,
        content: "Remember the issue operating context.",
        freshness: "static",
        updatedAt: expect.any(String),
        rank: 3,
      },
      {
        scope: "agent",
        source: "agent.capabilities",
        sourceId: agent.id,
        content: "Ship code with tests and clear handoffs.",
        freshness: "static",
        updatedAt: expect.any(String),
        rank: 4,
      },
    ]);
    expect(bundle.verification).toEqual({
      required: true,
      requiresEvaluatorSummary: true,
      requiresArtifacts: false,
      latestVerificationRunId: null,
      reviewReadyAt: null,
      runner: {
        target: "local_host",
        provider: "local_process",
        workspaceStrategyType: "git_worktree",
        executionMode: "isolated_workspace",
        browserCapable: false,
        sandboxed: false,
        isolationBoundary: "host_process",
      },
    });
    expect(bundle.swarm).toEqual({
      plan: null,
      currentSubtask: null,
    });
    expect(bundle.projection.runtime).toBe("codex");
  }, 20_000);

  it("carries issue-level evidence policy overrides into the runtime bundle policy block", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Worker",
      role: "engineer",
      adapterType: "opencode_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Respect evidence override",
      description: "The worker should see the strict evidence policy.",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
      evidencePolicy: "code_ci_evaluator_summary_artifacts",
      evidencePolicySource: "issue_override",
    }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "queued",
      runType: "verification",
      rootRunId: null,
      parentRunId: null,
      graphDepth: 0,
      repairAttempt: 2,
      verificationVerdict: null,
      policySnapshotJson: {
        evidencePolicy: "code_ci_evaluator_summary_artifacts",
        evidencePolicySource: "issue_override",
        maxRepairAttempts: 5,
        requiresHumanArtifacts: true,
      },
      contextSnapshot: { issueId: issue.id },
    }).returning();

    const bundle = await resolveRuntimeBundle(db, {
      companyId: company.id,
      issueId: issue.id,
      agentId: agent.id,
      runId: run.id,
      runtime: "opencode",
    });

    expect(bundle.policy).toEqual({
      tddMode: "required",
      evidencePolicy: "code_ci_evaluator_summary_artifacts",
      evidencePolicySource: "issue_override",
      maxRepairAttempts: 5,
      requiresHumanArtifacts: true,
    });
    expect(bundle.run).toEqual({
      id: run.id,
      runType: "verification",
      rootRunId: null,
      parentRunId: null,
      graphDepth: 0,
      repairAttempt: 2,
      verificationVerdict: null,
    });
    expect(bundle.runner).toEqual({
      target: "cloud_sandbox",
      provider: "cloud_sandbox",
      workspaceStrategyType: null,
      executionMode: null,
      browserCapable: true,
      sandboxed: true,
      isolationBoundary: "cloud_sandbox",
    });
    expect(bundle.verification).toEqual({
      required: true,
      requiresEvaluatorSummary: true,
      requiresArtifacts: true,
      latestVerificationRunId: null,
      reviewReadyAt: null,
      runner: {
        target: "cloud_sandbox",
        provider: "cloud_sandbox",
        workspaceStrategyType: null,
        executionMode: null,
        browserCapable: true,
        sandboxed: true,
        isolationBoundary: "cloud_sandbox",
      },
    });
    expect(bundle.memory.snippets).toEqual([
      {
        scope: "issue",
        source: "issue.description",
        sourceId: issue.id,
        content: "The worker should see the strict evidence policy.",
        freshness: "static",
        updatedAt: expect.any(String),
        rank: 3,
      },
    ]);
  }, 20_000);

  it("includes published shared-context items in the runtime recall packet with governance-aware scoping", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({
      name: "Paperclip",
      issuePrefix: "TST",
      description: "Company context",
    }).returning();
    const [project] = await db.insert(projects).values({
      companyId: company.id,
      name: "Shared Context Project",
      description: "Project context",
      status: "in_progress",
    }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      projectId: project.id,
      name: "Worker",
      role: "engineer",
      adapterType: "hermes_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      projectId: project.id,
      title: "Use shared context",
      description: "Issue context",
      status: "todo",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const proposedFreshnessAt = new Date("2026-03-24T12:00:00.000Z");

    await db.insert(sharedContextPublications).values([
      {
        companyId: company.id,
        title: "Company convention",
        body: "Prefer reviewable evidence over hidden local memory.",
        visibility: "company",
        status: "published",
        freshness: "recent",
        rank: 30,
      },
      {
        companyId: company.id,
        projectId: project.id,
        title: "Project convention",
        body: "Use the Paperclip helper before raw curl.",
        visibility: "project",
        status: "published",
        freshness: "recent",
        rank: 20,
      },
      {
        companyId: company.id,
        issueId: issue.id,
        title: "Issue finding",
        body: "The current worker should preserve the containerized execution boundary.",
        visibility: "issue",
        status: "published",
        freshness: "live",
        rank: 10,
      },
      {
        companyId: company.id,
        title: "Needs approval",
        body: "This proposed item must not leak into the runtime recall yet.",
        visibility: "company",
        status: "proposed",
        freshness: "recent",
        freshnessAt: proposedFreshnessAt,
      },
      {
        companyId: company.id,
        title: "Targeted to worker",
        body: "Only the addressed agent should see this targeted context.",
        visibility: "agent_set",
        audienceAgentIds: [agent.id],
        status: "published",
        freshness: "recent",
        rank: 15,
      },
    ]);

    const bundle = await resolveRuntimeBundle(db, {
      companyId: company.id,
      issueId: issue.id,
      agentId: agent.id,
      runId: null,
      runtime: "hermes",
    });

    expect(bundle.memory.snippets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "shared_context.issue",
          content: expect.stringContaining("Issue finding"),
          freshness: "live",
          rank: 10,
        }),
        expect.objectContaining({
          source: "shared_context.project",
          content: expect.stringContaining("Project convention"),
          freshness: "recent",
          rank: 20,
        }),
        expect.objectContaining({
          source: "shared_context.agent_set",
          content: expect.stringContaining("Targeted to worker"),
          freshness: "recent",
          rank: 15,
        }),
        expect.objectContaining({
          source: "shared_context.company",
          content: expect.stringContaining("Company convention"),
          freshness: "recent",
          rank: 30,
        }),
      ]),
    );
    expect(bundle.memory.snippets.some((snippet) => snippet.content.includes("Needs approval"))).toBe(false);

    await db
      .update(sharedContextPublications)
      .set({ status: "published", updatedAt: new Date("2026-03-24T12:05:00.000Z") })
      .where(eq(sharedContextPublications.title, "Needs approval"));

    const bundleAfterApproval = await resolveRuntimeBundle(db, {
      companyId: company.id,
      issueId: issue.id,
      agentId: agent.id,
      runId: null,
      runtime: "hermes",
    });

    expect(bundleAfterApproval.memory.snippets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "shared_context.company",
          content: expect.stringContaining("Needs approval"),
          freshness: "recent",
        }),
      ]),
    );
  }, 20_000);

  it("projects planner swarm plans and worker subtasks into the runtime bundle", async () => {
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
      title: "Fan out bounded work",
      description: "Planner should pass bounded subtask context to workers.",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const planner = await graph.startPlannerRoot(issue.id, agent.id);
    await graph.attachSwarmPlan(planner.id, {
      version: "v1",
      plannerRunId: planner.id,
      generatedAt: "2026-03-24T18:55:00.000Z",
      rationale: "Split the work into a code slice and a verification slice.",
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
    });
    const [worker] = await graph.spawnWorkers(planner.id, [
      {
        taskKey: "heartbeat-ui",
        subtask: {
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
        contextSnapshot: {
          swarmWorkspaceGuard: {
            enforcedMode: "isolated_workspace",
            warnings: [
              "Swarm subtask worker-heartbeat-ui forced into an isolated workspace to avoid parallel edit collisions.",
            ],
            errors: [],
          },
        },
      },
    ]);

    const bundle = await resolveRuntimeBundle(db, {
      companyId: company.id,
      issueId: issue.id,
      agentId: agent.id,
      runId: worker.id,
      runtime: "codex",
    });

    expect(bundle.swarm.plan).toMatchObject({
      version: "v1",
      plannerRunId: planner.id,
      subtasks: [
        {
          id: "worker-heartbeat-ui",
          taskKey: "heartbeat-ui",
          recommendedModelTier: "balanced",
        },
        {
          id: "verify-heartbeat-ui",
          taskKey: "verify-heartbeat-ui",
          recommendedModelTier: "premium",
        },
      ],
    });
    expect(bundle.swarm.currentSubtask).toEqual(
      expect.objectContaining({
        id: "worker-heartbeat-ui",
        title: "Update heartbeat UI labels",
        allowedPaths: ["ui/src/components/ActivityRow.tsx"],
        ownershipMode: "exclusive",
      }),
    );
    expect((bundle.swarm as Record<string, unknown>).workspaceGuard).toEqual({
      enforcedMode: "isolated_workspace",
      warnings: [
        "Swarm subtask worker-heartbeat-ui forced into an isolated workspace to avoid parallel edit collisions.",
      ],
      errors: [],
    });
  }, 20_000);
});

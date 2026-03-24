import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issues } from "@paperclipai/db";
import {
  swarmPlanSchema,
  swarmSubtaskSchema,
} from "@paperclipai/shared";
import type {
  EvidencePolicy,
  EvidencePolicySource,
  HeartbeatRunStatus,
  HeartbeatRunType,
  HeartbeatRun,
  IssueOrchestrationSummary,
  OrchestrationPolicySnapshot,
  SwarmPlan,
  SwarmSubtask,
  VerificationVerdict,
} from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { issueRunEvidenceService } from "./issue-run-evidence.js";
import { buildSwarmPolicySnapshot, resolveSwarmModelTier, shouldSwarm } from "./swarm-policy.js";

const MAX_WORKER_CHILDREN = 16;
const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;
type HeartbeatRunRow = typeof heartbeatRuns.$inferSelect;

type SpawnWorkerInput = {
  agentId?: string | null;
  taskKey?: string | null;
  invocationSource?: HeartbeatRun["invocationSource"];
  triggerDetail?: HeartbeatRun["triggerDetail"];
  contextSnapshot?: Record<string, unknown> | null;
  status?: HeartbeatRun["status"];
  subtask?: SwarmSubtask | null;
};

type PlannerGraphMetadata = Pick<HeartbeatRun, "runType" | "rootRunId" | "parentRunId" | "graphDepth"> & {
  root: HeartbeatRunRow;
};

function readIssueId(value: Record<string, unknown> | null | undefined) {
  const issueId = value?.issueId;
  return typeof issueId === "string" && issueId.trim().length > 0 ? issueId.trim() : null;
}

function asRunType(value: string): HeartbeatRunType {
  return value as HeartbeatRunType;
}

function asRunStatus(value: string): HeartbeatRunStatus {
  return value as HeartbeatRunStatus;
}

function asVerificationVerdict(value: string | null): VerificationVerdict | null {
  return value as VerificationVerdict | null;
}

function resolveMaxRepairAttempts(policy: OrchestrationPolicySnapshot | null | undefined) {
  const raw = Number(policy?.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS);
  if (!Number.isFinite(raw)) return DEFAULT_MAX_REPAIR_ATTEMPTS;
  return Math.max(0, Math.trunc(raw));
}

function readSwarmPlan(value: Record<string, unknown> | null | undefined): SwarmPlan | null {
  const candidate = value?.swarmPlan;
  const parsed = swarmPlanSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function readSwarmSubtask(value: Record<string, unknown> | null | undefined): SwarmSubtask | null {
  const candidate = value?.swarmSubtask;
  const parsed = swarmSubtaskSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function issueRunGraphService(db: Db) {
  const evidence = issueRunEvidenceService(db);

  async function getIssue(issueId: string) {
    return db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        assigneeAgentId: issues.assigneeAgentId,
        evidencePolicy: issues.evidencePolicy,
        evidencePolicySource: issues.evidencePolicySource,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
  }

  async function getRun(runId: string) {
    return db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function findPlannerRoot(issueId: string, companyId: string) {
    return db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.runType, "planner"),
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function startPlannerRoot(issueId: string, agentId: string) {
    const issue = await getIssue(issueId);
    if (!issue) throw notFound("Issue not found");

    const existing = await findPlannerRoot(issue.id, issue.companyId);
    if (existing) return existing;

    const [inserted] = await db
      .insert(heartbeatRuns)
      .values({
        companyId: issue.companyId,
        agentId,
        invocationSource: "assignment",
        triggerDetail: "system",
        status: "queued",
        runType: "planner",
        rootRunId: null,
        parentRunId: null,
        graphDepth: 0,
        repairAttempt: 0,
        policySnapshotJson: buildSwarmPolicySnapshot({
          evidencePolicy: issue.evidencePolicy as EvidencePolicy,
          evidencePolicySource: issue.evidencePolicySource as EvidencePolicySource,
          tier: "premium",
        }),
        contextSnapshot: {
          issueId: issue.id,
          source: "issue.run_graph",
          role: "planner_root",
          swarmModelTier: "premium",
        },
      })
      .returning();

    const [root] = await db
      .update(heartbeatRuns)
      .set({
        rootRunId: inserted.id,
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, inserted.id))
      .returning();

    return root;
  }

  async function attachSwarmPlan(rootRunId: string, swarmPlan: SwarmPlan) {
    const root = await getRun(rootRunId);
    if (!root) throw notFound("Planner root not found");
    if (root.runType !== "planner") throw conflict("Swarm plans can only attach to planner roots");

    const normalizedPlan = swarmPlanSchema.parse({
      ...swarmPlan,
      plannerRunId: swarmPlan.plannerRunId ?? root.id,
    });
    const admission = shouldSwarm({
      plan: normalizedPlan,
      maxChildren: MAX_WORKER_CHILDREN,
    });

    const [updated] = await db
      .update(heartbeatRuns)
      .set({
        contextSnapshot: {
          ...(root.contextSnapshot ?? {}),
          swarmPlan: normalizedPlan,
          swarmAdmission: admission,
        },
        policySnapshotJson: {
          ...((root.policySnapshotJson ?? {}) as OrchestrationPolicySnapshot),
          swarmAdmission: admission,
          swarmEnabled: admission.admitted,
          swarmPlannerRunId: normalizedPlan.plannerRunId ?? root.id,
        },
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, root.id))
      .returning();

    return updated;
  }

  async function resolvePlannerGraph(issueId: string, agentId: string): Promise<PlannerGraphMetadata> {
    const root = await startPlannerRoot(issueId, agentId);
    return {
      root,
      runType: "planner",
      rootRunId: root.id,
      parentRunId: null,
      graphDepth: root.graphDepth ?? 0,
    };
  }

  async function spawnWorkers(rootRunId: string, workers: SpawnWorkerInput[]) {
    const root = await getRun(rootRunId);
    if (!root) throw notFound("Planner root not found");
    if (root.runType !== "planner") throw conflict("Worker fan-out requires a planner root");

    const issueId = readIssueId(root.contextSnapshot);
    const swarmPlan = readSwarmPlan(root.contextSnapshot);
    const issue = issueId ? await getIssue(issueId) : null;
    const swarmAdmission = shouldSwarm({
      plan: swarmPlan,
      maxChildren: MAX_WORKER_CHILDREN,
    });
    if (swarmPlan && !swarmAdmission.admitted) {
      throw conflict("Worker fan-out blocked by swarm admission policy", swarmAdmission);
    }
    const existingChildren = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.parentRunId, root.id))
      .then((rows) => Number(rows[0]?.count ?? 0));

    if (existingChildren + workers.length > MAX_WORKER_CHILDREN) {
      throw conflict("Worker fan-out exceeds orchestration limit", {
        limit: MAX_WORKER_CHILDREN,
        existingChildren,
        requestedChildren: workers.length,
      });
    }

    const inserted = await db
      .insert(heartbeatRuns)
      .values(
        workers.map((worker) => {
          const normalizedSubtask = worker.subtask ? swarmSubtaskSchema.parse(worker.subtask) : null;
          const swarmModelTier = normalizedSubtask ? resolveSwarmModelTier(normalizedSubtask) : "balanced";
          return {
            companyId: root.companyId,
            agentId: worker.agentId ?? root.agentId,
            invocationSource: worker.invocationSource ?? "assignment",
            triggerDetail: worker.triggerDetail ?? "system",
            status: worker.status ?? "queued",
            runType: "worker",
            rootRunId: root.id,
            parentRunId: root.id,
            graphDepth: (root.graphDepth ?? 0) + 1,
            repairAttempt: 0,
            policySnapshotJson: buildSwarmPolicySnapshot({
              evidencePolicy: (issue?.evidencePolicy ?? "code_ci_evaluator_summary") as EvidencePolicy,
              evidencePolicySource: (issue?.evidencePolicySource ?? "company_default") as EvidencePolicySource,
              tier: swarmModelTier,
              plannerRunId: swarmPlan?.plannerRunId ?? root.id,
              subtask: normalizedSubtask,
              admission: swarmAdmission,
            }),
            contextSnapshot: {
              issueId,
              ...(worker.contextSnapshot ?? {}),
              ...(worker.taskKey ? { taskKey: worker.taskKey } : {}),
              swarmModelTier,
              ...(normalizedSubtask ? { swarmSubtask: normalizedSubtask } : {}),
              ...(normalizedSubtask?.id ? { swarmSubtaskId: normalizedSubtask.id } : {}),
              ...(swarmPlan ? { swarmPlanVersion: swarmPlan.version } : {}),
            },
          };
        }),
      )
      .returning();

    return inserted;
  }

  async function scheduleRepairFromVerification(verificationRunId: string) {
    const verification = await getRun(verificationRunId);
    if (!verification) throw notFound("Verification run not found");
    if (verification.runType !== "verification") throw conflict("Repair scheduling requires a verification run");
    if (verification.verificationVerdict !== "repair") return null;

    const worker = verification.parentRunId ? await getRun(verification.parentRunId) : null;
    if (!worker) throw notFound("Verified worker run not found");
    const plannerRootId = worker.rootRunId ?? verification.rootRunId;
    if (!plannerRootId) throw conflict("Verification run is missing a planner root");
    const planner = await getRun(plannerRootId);
    if (!planner || planner.runType !== "planner") throw conflict("Repair scheduling requires a planner root");

    const maxRepairAttempts = resolveMaxRepairAttempts(
      verification.policySnapshotJson as OrchestrationPolicySnapshot | null | undefined,
    );
    const nextRepairAttempt = (worker.repairAttempt ?? 0) + 1;
    if (nextRepairAttempt > maxRepairAttempts) return null;

    const existingRetry = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, planner.companyId),
          eq(heartbeatRuns.runType, "worker"),
          sql`${heartbeatRuns.contextSnapshot} ->> 'verificationRunId' = ${verification.id}`,
        ),
      )
      .orderBy(asc(heartbeatRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (existingRetry) return existingRetry;

    const [retryWorker] = await db
      .insert(heartbeatRuns)
      .values({
        companyId: planner.companyId,
        agentId: worker.agentId,
        invocationSource: worker.invocationSource,
        triggerDetail: worker.triggerDetail,
        status: "queued",
        runType: "worker",
        rootRunId: planner.id,
        parentRunId: planner.id,
        graphDepth: (planner.graphDepth ?? 0) + 1,
        repairAttempt: nextRepairAttempt,
        policySnapshotJson: verification.policySnapshotJson,
        contextSnapshot: {
          ...(worker.contextSnapshot ?? {}),
          repairSourceRunId: worker.id,
          verificationRunId: verification.id,
        },
      })
      .returning();

    return retryWorker;
  }

  async function getIssueSummary(issueId: string): Promise<IssueOrchestrationSummary> {
    return db.transaction(async (tx) => {
      const scopedEvidence = issueRunEvidenceService(tx as unknown as Db);
      const issue = await tx
        .select({
          id: issues.id,
          companyId: issues.companyId,
          assigneeAgentId: issues.assigneeAgentId,
        })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue) throw notFound("Issue not found");

      const runs = await tx
        .select({
          id: heartbeatRuns.id,
          runType: heartbeatRuns.runType,
          status: heartbeatRuns.status,
          parentRunId: heartbeatRuns.parentRunId,
          rootRunId: heartbeatRuns.rootRunId,
          graphDepth: heartbeatRuns.graphDepth,
          repairAttempt: heartbeatRuns.repairAttempt,
          verificationVerdict: heartbeatRuns.verificationVerdict,
          runnerSnapshotJson: heartbeatRuns.runnerSnapshotJson,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, issue.companyId),
            sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
          ),
        )
        .orderBy(asc(heartbeatRuns.graphDepth), asc(heartbeatRuns.createdAt));

      const evidenceBundle = await scopedEvidence.getIssueEvidenceBundle(issue.id);
      const rootRunId =
        runs.find((run) => run.runType === "planner")?.id ??
        runs.find((run) => run.graphDepth === 0)?.id ??
        null;

      return {
        rootRunId,
        lastVerificationRunId: evidenceBundle.lastVerificationRunId,
        reviewReadyAt: evidenceBundle.reviewReadyAt,
        evidencePolicy: evidenceBundle.policy,
        evidencePolicySource: evidenceBundle.policySource,
        evidenceBundle,
        nodes: runs.map((run) => ({
          id: run.id,
          runType: asRunType(run.runType),
          status: asRunStatus(run.status),
          parentRunId: run.parentRunId,
          rootRunId: run.rootRunId,
          graphDepth: run.graphDepth,
          repairAttempt: run.repairAttempt,
          verificationVerdict: asVerificationVerdict(run.verificationVerdict),
          runnerSnapshotJson: (run.runnerSnapshotJson as IssueOrchestrationSummary["nodes"][number]["runnerSnapshotJson"]) ?? null,
        })),
      };
    });
  }

  return {
    attachSwarmPlan,
    getIssueSummary,
    resolvePlannerGraph,
    scheduleRepairFromVerification,
    spawnWorkers,
    startPlannerRoot,
  };
}

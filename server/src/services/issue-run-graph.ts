import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issues } from "@paperclipai/db";
import type {
  HeartbeatRunStatus,
  HeartbeatRunType,
  HeartbeatRun,
  IssueOrchestrationSummary,
  VerificationVerdict,
} from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";

const MAX_WORKER_CHILDREN = 16;
type HeartbeatRunRow = typeof heartbeatRuns.$inferSelect;

type SpawnWorkerInput = {
  agentId?: string | null;
  taskKey?: string | null;
  invocationSource?: HeartbeatRun["invocationSource"];
  triggerDetail?: HeartbeatRun["triggerDetail"];
  contextSnapshot?: Record<string, unknown> | null;
  status?: HeartbeatRun["status"];
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

export function issueRunGraphService(db: Db) {
  async function getIssue(issueId: string) {
    return db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        assigneeAgentId: issues.assigneeAgentId,
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
        contextSnapshot: {
          issueId: issue.id,
          source: "issue.run_graph",
          role: "planner_root",
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
        workers.map((worker) => ({
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
          contextSnapshot: {
            issueId,
            ...(worker.contextSnapshot ?? {}),
            ...(worker.taskKey ? { taskKey: worker.taskKey } : {}),
          },
        })),
      )
      .returning();

    return inserted;
  }

  async function getIssueSummary(issueId: string): Promise<IssueOrchestrationSummary> {
    const issue = await getIssue(issueId);
    if (!issue) throw notFound("Issue not found");

    const runs = await db
      .select({
        id: heartbeatRuns.id,
        runType: heartbeatRuns.runType,
        status: heartbeatRuns.status,
        parentRunId: heartbeatRuns.parentRunId,
        rootRunId: heartbeatRuns.rootRunId,
        graphDepth: heartbeatRuns.graphDepth,
        repairAttempt: heartbeatRuns.repairAttempt,
        verificationVerdict: heartbeatRuns.verificationVerdict,
        finishedAt: heartbeatRuns.finishedAt,
        artifactBundleJson: heartbeatRuns.artifactBundleJson,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, issue.companyId),
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
        ),
      )
      .orderBy(asc(heartbeatRuns.graphDepth), asc(heartbeatRuns.createdAt));

    const rootRunId =
      runs.find((run) => run.runType === "planner")?.id ??
      runs.find((run) => run.graphDepth === 0)?.id ??
      null;
    const verificationRuns = runs.filter((run) => run.runType === "verification");
    const lastVerification = verificationRuns.at(-1) ?? null;
    const reviewReadyAt =
      lastVerification?.verificationVerdict === "pass" ? lastVerification.finishedAt ?? null : null;

    return {
      rootRunId,
      lastVerificationRunId: lastVerification?.id ?? null,
      reviewReadyAt,
      evidencePolicy: "code_ci_evaluator_summary",
      evidencePolicySource: "company_default",
      nodes: runs.map((run) => ({
        id: run.id,
        runType: asRunType(run.runType),
        status: asRunStatus(run.status),
        parentRunId: run.parentRunId,
        rootRunId: run.rootRunId,
        graphDepth: run.graphDepth,
        repairAttempt: run.repairAttempt,
        verificationVerdict: asVerificationVerdict(run.verificationVerdict),
      })),
    };
  }

  return {
    getIssueSummary,
    resolvePlannerGraph,
    spawnWorkers,
    startPlannerRoot,
  };
}

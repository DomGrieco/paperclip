import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies, heartbeatRuns, issues, projects } from "@paperclipai/db";
import {
  swarmPlanSchema,
  swarmSubtaskSchema,
} from "@paperclipai/shared";
import type {
  OrchestrationPolicySnapshot,
  RuntimeBundle,
  RuntimeBundleTarget,
  SwarmPlan,
  SwarmSubtask,
} from "@paperclipai/shared";
import { notFound } from "../errors.js";
import { applyVerificationRunnerPolicy, resolvePlannedRunnerSnapshot } from "./runner-plane.js";
import { sharedContextService } from "./shared-context-publications.js";

type ResolveRuntimeBundleInput = {
  companyId: string;
  issueId: string;
  agentId: string;
  runId?: string | null;
  runtime: RuntimeBundleTarget;
};

const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

function resolveMaxRepairAttempts(policy: OrchestrationPolicySnapshot | null | undefined) {
  const raw = Number(policy?.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS);
  if (!Number.isFinite(raw)) return DEFAULT_MAX_REPAIR_ATTEMPTS;
  return Math.max(0, Math.trunc(raw));
}

function requiresHumanArtifacts(evidencePolicy: string) {
  return evidencePolicy === "code_ci_evaluator_summary_artifacts";
}

function readSwarmPlan(candidate: unknown): SwarmPlan | null {
  const parsed = swarmPlanSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function readSwarmSubtask(candidate: unknown): SwarmSubtask | null {
  const parsed = swarmSubtaskSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function resolveCurrentSwarmSubtask(input: {
  swarmPlan: SwarmPlan | null;
  currentRunContext: Record<string, unknown> | null | undefined;
}): SwarmSubtask | null {
  const directSubtask = readSwarmSubtask(input.currentRunContext?.swarmSubtask);
  if (directSubtask) return directSubtask;

  const subtaskId = typeof input.currentRunContext?.swarmSubtaskId === "string"
    ? input.currentRunContext.swarmSubtaskId
    : typeof input.currentRunContext?.taskKey === "string"
      ? input.currentRunContext.taskKey
      : null;
  if (!subtaskId || !input.swarmPlan) return null;

  return input.swarmPlan.subtasks.find((subtask) => subtask.id === subtaskId || subtask.taskKey === subtaskId) ?? null;
}

function readSwarmWorkspaceGuard(candidate: unknown): { enforcedMode: string; warnings: string[]; errors: string[] } | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const rec = candidate as Record<string, unknown>;
  const warnings = Array.isArray(rec.warnings) ? rec.warnings.filter((value): value is string => typeof value === "string") : [];
  const errors = Array.isArray(rec.errors) ? rec.errors.filter((value): value is string => typeof value === "string") : [];
  const enforcedMode = typeof rec.enforcedMode === "string" && rec.enforcedMode.length > 0 ? rec.enforcedMode : "shared_workspace";
  return { enforcedMode, warnings, errors };
}

export function resolveRuntimeBundleTarget(adapterType: string | null | undefined): RuntimeBundleTarget | null {
  if (adapterType === "codex_local") return "codex";
  if (adapterType === "cursor") return "cursor";
  if (adapterType === "opencode_local") return "opencode";
  if (adapterType === "hermes_local") return "hermes";
  return null;
}

export function buildRuntimeBundleProjection(runtime: RuntimeBundleTarget): RuntimeBundle["projection"] {
  return {
    runtime,
    contextKey: "paperclipRuntimeBundle",
    envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON",
    materializationRoot: ".paperclip/runtime",
  };
}

export async function resolveRuntimeBundle(db: Db, input: ResolveRuntimeBundleInput): Promise<RuntimeBundle> {
  const [agent, issue, company, run] = await Promise.all([
    db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        name: agents.name,
        adapterType: agents.adapterType,
        role: agents.role,
        title: agents.title,
        capabilities: agents.capabilities,
        updatedAt: agents.updatedAt,
      })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        projectId: issues.projectId,
        identifier: issues.identifier,
        title: issues.title,
        description: issues.description,
        status: issues.status,
        priority: issues.priority,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
        evidencePolicy: issues.evidencePolicy,
        evidencePolicySource: issues.evidencePolicySource,
        reviewReadyAt: issues.reviewReadyAt,
        lastVerificationRunId: issues.lastVerificationRunId,
      })
      .from(issues)
      .where(eq(issues.id, input.issueId))
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: companies.id,
        description: companies.description,
        updatedAt: companies.updatedAt,
      })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .then((rows) => rows[0] ?? null),
    input.runId
      ? db
          .select({
            id: heartbeatRuns.id,
            runType: heartbeatRuns.runType,
            rootRunId: heartbeatRuns.rootRunId,
            parentRunId: heartbeatRuns.parentRunId,
            graphDepth: heartbeatRuns.graphDepth,
            repairAttempt: heartbeatRuns.repairAttempt,
            verificationVerdict: heartbeatRuns.verificationVerdict,
            policySnapshotJson: heartbeatRuns.policySnapshotJson,
            contextSnapshot: heartbeatRuns.contextSnapshot,
          })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, input.runId))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  if (!agent || agent.companyId !== input.companyId) throw notFound("Agent not found");
  if (!issue || issue.companyId !== input.companyId) throw notFound("Issue not found");

  const project = issue.projectId
    ? await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          executionWorkspacePolicy: projects.executionWorkspacePolicy,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(eq(projects.id, issue.projectId))
        .then((rows) => rows[0] ?? null)
    : null;

  const plannerRoot = run?.rootRunId
    ? await db
        .select({
          id: heartbeatRuns.id,
          contextSnapshot: heartbeatRuns.contextSnapshot,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, run.rootRunId))
        .then((rows) => rows[0] ?? null)
    : null;
  const swarmPlan = readSwarmPlan(run?.contextSnapshot?.swarmPlan ?? plannerRoot?.contextSnapshot?.swarmPlan);
  const currentSwarmSubtask = resolveCurrentSwarmSubtask({
    swarmPlan,
    currentRunContext: (run?.contextSnapshot ?? null) as Record<string, unknown> | null,
  });
  const swarmWorkspaceGuard = readSwarmWorkspaceGuard(run?.contextSnapshot?.swarmWorkspaceGuard ?? null);

  const policySnapshot = (run?.policySnapshotJson ?? null) as OrchestrationPolicySnapshot | null;
  const maxRepairAttempts = resolveMaxRepairAttempts(policySnapshot);
  const effectiveEvidencePolicy = issue.evidencePolicy as RuntimeBundle["policy"]["evidencePolicy"];
  const effectiveEvidencePolicySource = issue.evidencePolicySource as RuntimeBundle["policy"]["evidencePolicySource"];
  const plannedRunner = resolvePlannedRunnerSnapshot(project?.executionWorkspacePolicy ?? null);
  const effectiveRunner = applyVerificationRunnerPolicy({
    planned: plannedRunner,
    runType: run?.runType ?? null,
    evidencePolicy: issue.evidencePolicy,
  });
  const sharedContextSnippets = await sharedContextService(db).listRuntimeMemorySnippets({
    companyId: input.companyId,
    agentId: agent.id,
    projectId: project?.id ?? null,
    issueId: issue.id,
  });

  return {
    runtime: input.runtime,
    company: {
      id: input.companyId,
    },
    agent: {
      id: agent.id,
      name: agent.name,
      adapterType: agent.adapterType,
    },
    project: project
      ? {
          id: project.id,
          name: project.name,
          executionWorkspacePolicy: project.executionWorkspacePolicy ?? null,
        }
      : null,
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
    },
    run: {
      id: run?.id ?? input.runId ?? null,
      runType: (run?.runType ?? null) as RuntimeBundle["run"]["runType"],
      rootRunId: run?.rootRunId ?? null,
      parentRunId: run?.parentRunId ?? null,
      graphDepth: run?.graphDepth ?? null,
      repairAttempt: run?.repairAttempt ?? 0,
      verificationVerdict: (run?.verificationVerdict ?? null) as RuntimeBundle["run"]["verificationVerdict"],
    },
    policy: {
      tddMode: "required",
      evidencePolicy: effectiveEvidencePolicy,
      evidencePolicySource: effectiveEvidencePolicySource,
      maxRepairAttempts,
      requiresHumanArtifacts: requiresHumanArtifacts(issue.evidencePolicy),
    },
    runner: effectiveRunner,
    verification: {
      required: true,
      requiresEvaluatorSummary: true,
      requiresArtifacts: requiresHumanArtifacts(issue.evidencePolicy),
      latestVerificationRunId: issue.lastVerificationRunId ?? null,
      reviewReadyAt: issue.reviewReadyAt ? new Date(issue.reviewReadyAt).toISOString() : null,
      runner: effectiveRunner,
    },
    swarm: {
      plan: swarmPlan,
      currentSubtask: currentSwarmSubtask,
      ...(swarmWorkspaceGuard ? { workspaceGuard: swarmWorkspaceGuard } : {}),
    } as RuntimeBundle["swarm"],
    memory: {
      snippets: [
        ...(company?.description
          ? [
              {
                scope: "company" as const,
                source: "company.description",
                sourceId: company.id,
                content: company.description,
                freshness: "static" as const,
                updatedAt: new Date(company.updatedAt).toISOString(),
                rank: 1,
              },
            ]
          : []),
        ...(project?.description
          ? [
              {
                scope: "project" as const,
                source: "project.description",
                sourceId: project.id,
                content: project.description,
                freshness: "static" as const,
                updatedAt: new Date(project.updatedAt).toISOString(),
                rank: 2,
              },
            ]
          : []),
        ...(issue.description
          ? [
              {
                scope: "issue" as const,
                source: "issue.description",
                sourceId: issue.id,
                content: issue.description,
                freshness: "static" as const,
                updatedAt: new Date(issue.updatedAt ?? issue.createdAt).toISOString(),
                rank: 3,
              },
            ]
          : []),
        ...(agent.capabilities
          ? [
              {
                scope: "agent" as const,
                source: "agent.capabilities",
                sourceId: agent.id,
                content: agent.capabilities,
                freshness: "static" as const,
                updatedAt: new Date(agent.updatedAt).toISOString(),
                rank: 4,
              },
            ]
          : []),
        ...sharedContextSnippets,
      ],
    },
    projection: buildRuntimeBundleProjection(input.runtime),
  };
}

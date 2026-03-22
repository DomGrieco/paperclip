import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues, projects } from "@paperclipai/db";
import type { RuntimeBundle, RuntimeBundleTarget } from "@paperclipai/shared";
import { notFound } from "../errors.js";

type ResolveRuntimeBundleInput = {
  companyId: string;
  issueId: string;
  agentId: string;
  runId?: string | null;
  runtime: RuntimeBundleTarget;
};

export function resolveRuntimeBundleTarget(adapterType: string | null | undefined): RuntimeBundleTarget | null {
  if (adapterType === "codex_local") return "codex";
  if (adapterType === "cursor") return "cursor";
  if (adapterType === "opencode_local") return "opencode";
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

function deriveRunnerBundle(projectPolicy: Record<string, unknown> | null): RuntimeBundle["runner"] {
  const workspaceStrategy =
    projectPolicy && typeof projectPolicy.workspaceStrategy === "object" && projectPolicy.workspaceStrategy
      ? (projectPolicy.workspaceStrategy as Record<string, unknown>)
      : null;
  const defaultMode =
    projectPolicy && typeof projectPolicy.defaultMode === "string" ? (projectPolicy.defaultMode as string) : null;
  const strategyType =
    workspaceStrategy && typeof workspaceStrategy.type === "string" ? (workspaceStrategy.type as string) : null;

  if (strategyType === "cloud_sandbox") {
    return {
      target: "cloud_sandbox",
      provider: "cloud_sandbox",
      workspaceStrategyType: strategyType,
      executionMode: defaultMode,
      browserCapable: true,
      sandboxed: true,
      isolationBoundary: "cloud_sandbox",
    };
  }

  if (strategyType === "adapter_managed") {
    return {
      target: "adapter_managed",
      provider: "adapter_managed",
      workspaceStrategyType: strategyType,
      executionMode: defaultMode,
      browserCapable: false,
      sandboxed: true,
      isolationBoundary: "adapter_runtime",
    };
  }

  return {
    target: "local_host",
    provider: "local_process",
    workspaceStrategyType: strategyType,
    executionMode: defaultMode,
    browserCapable: false,
    sandboxed: false,
    isolationBoundary: "host_process",
  };
}

export async function resolveRuntimeBundle(db: Db, input: ResolveRuntimeBundleInput): Promise<RuntimeBundle> {
  const [agent, issue] = await Promise.all([
    db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        name: agents.name,
        adapterType: agents.adapterType,
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
      })
      .from(issues)
      .where(eq(issues.id, input.issueId))
      .then((rows) => rows[0] ?? null),
  ]);

  if (!agent || agent.companyId !== input.companyId) throw notFound("Agent not found");
  if (!issue || issue.companyId !== input.companyId) throw notFound("Issue not found");

  const project = issue.projectId
    ? await db
        .select({
          id: projects.id,
          name: projects.name,
          executionWorkspacePolicy: projects.executionWorkspacePolicy,
        })
        .from(projects)
        .where(eq(projects.id, issue.projectId))
        .then((rows) => rows[0] ?? null)
    : null;

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
      id: input.runId ?? null,
    },
    policy: {
      tddMode: "required",
      evidencePolicy: issue.evidencePolicy as RuntimeBundle["policy"]["evidencePolicy"],
      evidencePolicySource: issue.evidencePolicySource as RuntimeBundle["policy"]["evidencePolicySource"],
    },
    runner: deriveRunnerBundle(project?.executionWorkspacePolicy ?? null),
    memory: {
      snippets: issue.description
        ? [
            {
              scope: "issue",
              source: "issue.description",
              sourceId: issue.id,
              content: issue.description,
              freshness: "static",
              updatedAt: new Date(issue.updatedAt ?? issue.createdAt).toISOString(),
              rank: 1,
            },
          ]
        : [],
    },
    projection: buildRuntimeBundleProjection(input.runtime),
  };
}

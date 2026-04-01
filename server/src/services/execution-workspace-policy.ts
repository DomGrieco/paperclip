import type {
  ExecutionWorkspaceMode,
  ExecutionWorkspaceStrategy,
  IssueExecutionWorkspaceSettings,
  ProjectExecutionWorkspaceDefaultMode,
  ProjectExecutionWorkspacePolicy,
  SwarmSubtask,
} from "@paperclipai/shared";
import { asString, parseObject } from "../adapters/utils.js";

type ParsedExecutionWorkspaceMode = Exclude<ExecutionWorkspaceMode, "inherit" | "reuse_existing">;

function cloneStrategy(strategy: ExecutionWorkspaceStrategy | null | undefined): ExecutionWorkspaceStrategy | null {
  if (!strategy) return null;
  return { ...strategy };
}

function sanitizeSwarmWorkspaceToken(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/.]+|[-/.]+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function appendSwarmWorkspaceBranchSuffix(template: string, suffix: string): string {
  const trimmed = template.trim();
  if (!trimmed) return `{{issue.identifier}}-{{slug}}-${suffix}`;
  if (trimmed.includes(suffix)) return trimmed;
  return `${trimmed}-${suffix}`;
}

export function shouldForceIsolatedWorkspaceForSwarmSubtask(subtask: SwarmSubtask | null | undefined): boolean {
  if (!subtask) return false;
  if (subtask.kind !== "implementation") return false;
  return (subtask.ownershipMode ?? "exclusive") !== "read_only";
}

export function deriveSwarmWorkspaceGuard(input: {
  mode: ParsedExecutionWorkspaceMode;
  subtask: SwarmSubtask | null | undefined;
}): {
  enforcedMode: ParsedExecutionWorkspaceMode;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const subtask = input.subtask ?? null;

  let enforcedMode = input.mode;
  if (shouldForceIsolatedWorkspaceForSwarmSubtask(subtask) && input.mode !== "isolated_workspace") {
    enforcedMode = "isolated_workspace";
    warnings.push(
      `Swarm subtask ${subtask?.id ?? "unknown"} forced into an isolated workspace to avoid parallel edit collisions.`,
    );
  }

  if (!subtask) {
    return { enforcedMode, warnings, errors };
  }

  const allowedPaths = (subtask.allowedPaths ?? []).filter((value) => typeof value === "string" && value.trim().length > 0);
  const forbiddenPaths = (subtask.forbiddenPaths ?? []).filter((value) => typeof value === "string" && value.trim().length > 0);
  const forbiddenSet = new Set(forbiddenPaths.map((value) => value.trim()));
  const overlappingPaths = allowedPaths.filter((value) => forbiddenSet.has(value.trim()));
  if (overlappingPaths.length > 0) {
    errors.push(
      `Swarm subtask ${subtask.id} has overlapping allowedPaths/forbiddenPaths entries: ${overlappingPaths.join(", ")}.`,
    );
  }

  if (enforcedMode === "shared_workspace" && (subtask.ownershipMode ?? "exclusive") === "exclusive" && allowedPaths.length === 0) {
    errors.push(
      `Swarm subtask ${subtask.id} requests exclusive ownership in a shared workspace but does not declare allowedPaths.`,
    );
  }

  if ((subtask.ownershipMode ?? null) === "read_only" && allowedPaths.length > 0) {
    warnings.push(
      `Swarm subtask ${subtask.id} is read_only; allowedPaths are advisory only and should not be modified.`,
    );
  }

  return { enforcedMode, warnings, errors };
}

function applySwarmWorkspaceStrategy(input: {
  strategy: ExecutionWorkspaceStrategy | null;
  enforcedMode: ParsedExecutionWorkspaceMode;
  subtask: SwarmSubtask | null | undefined;
}): ExecutionWorkspaceStrategy | null {
  if (input.enforcedMode !== "isolated_workspace") return input.strategy;

  const strategy = cloneStrategy(input.strategy) ?? ({ type: "git_worktree" } satisfies ExecutionWorkspaceStrategy);
  if (strategy.type !== "git_worktree") {
    return strategy;
  }

  const subtask = input.subtask ?? null;
  if (!subtask) {
    return strategy;
  }

  const suffix = sanitizeSwarmWorkspaceToken(subtask.taskKey ?? subtask.id, "swarm-worker");
  strategy.branchTemplate = appendSwarmWorkspaceBranchSuffix(
    typeof strategy.branchTemplate === "string" ? strategy.branchTemplate : "{{issue.identifier}}-{{slug}}",
    suffix,
  );
  return strategy;
}

function cloneRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  return { ...value };
}

function parseExecutionWorkspaceStrategy(raw: unknown): ExecutionWorkspaceStrategy | null {
  const parsed = parseObject(raw);
  const type = asString(parsed.type, "");
  if (type !== "project_primary" && type !== "git_worktree" && type !== "adapter_managed" && type !== "cloud_sandbox") {
    return null;
  }
  return {
    type,
    ...(typeof parsed.baseRef === "string" ? { baseRef: parsed.baseRef } : {}),
    ...(typeof parsed.branchTemplate === "string" ? { branchTemplate: parsed.branchTemplate } : {}),
    ...(typeof parsed.worktreeParentDir === "string" ? { worktreeParentDir: parsed.worktreeParentDir } : {}),
    ...(typeof parsed.provisionCommand === "string" ? { provisionCommand: parsed.provisionCommand } : {}),
    ...(typeof parsed.teardownCommand === "string" ? { teardownCommand: parsed.teardownCommand } : {}),
  };
}

export function parseProjectExecutionWorkspacePolicy(raw: unknown): ProjectExecutionWorkspacePolicy | null {
  const parsed = parseObject(raw);
  if (Object.keys(parsed).length === 0) return null;
  const enabled = typeof parsed.enabled === "boolean" ? parsed.enabled : false;
  const workspaceStrategy = parseExecutionWorkspaceStrategy(parsed.workspaceStrategy);
  const defaultMode = asString(parsed.defaultMode, "");
  const defaultProjectWorkspaceId =
    typeof parsed.defaultProjectWorkspaceId === "string" ? parsed.defaultProjectWorkspaceId : undefined;
  const allowIssueOverride =
    typeof parsed.allowIssueOverride === "boolean" ? parsed.allowIssueOverride : undefined;
  const normalizedDefaultMode = (() => {
    if (
      defaultMode === "shared_workspace" ||
      defaultMode === "isolated_workspace" ||
      defaultMode === "operator_branch" ||
      defaultMode === "adapter_default"
    ) {
      return defaultMode as ProjectExecutionWorkspaceDefaultMode;
    }
    if (defaultMode === "project_primary") return "shared_workspace";
    if (defaultMode === "isolated") return "isolated_workspace";
    return undefined;
  })();
  return {
    enabled,
    ...(normalizedDefaultMode ? { defaultMode: normalizedDefaultMode } : {}),
    ...(allowIssueOverride !== undefined ? { allowIssueOverride } : {}),
    ...(defaultProjectWorkspaceId ? { defaultProjectWorkspaceId } : {}),
    ...(workspaceStrategy ? { workspaceStrategy } : {}),
    ...(parsed.workspaceRuntime && typeof parsed.workspaceRuntime === "object" && !Array.isArray(parsed.workspaceRuntime)
      ? { workspaceRuntime: { ...(parsed.workspaceRuntime as Record<string, unknown>) } }
      : {}),
    ...(parsed.branchPolicy && typeof parsed.branchPolicy === "object" && !Array.isArray(parsed.branchPolicy)
      ? { branchPolicy: { ...(parsed.branchPolicy as Record<string, unknown>) } }
      : {}),
    ...(parsed.pullRequestPolicy && typeof parsed.pullRequestPolicy === "object" && !Array.isArray(parsed.pullRequestPolicy)
      ? { pullRequestPolicy: { ...(parsed.pullRequestPolicy as Record<string, unknown>) } }
      : {}),
    ...(parsed.runtimePolicy && typeof parsed.runtimePolicy === "object" && !Array.isArray(parsed.runtimePolicy)
      ? { runtimePolicy: { ...(parsed.runtimePolicy as Record<string, unknown>) } }
      : {}),
    ...(parsed.cleanupPolicy && typeof parsed.cleanupPolicy === "object" && !Array.isArray(parsed.cleanupPolicy)
      ? { cleanupPolicy: { ...(parsed.cleanupPolicy as Record<string, unknown>) } }
      : {}),
  };
}

export function gateProjectExecutionWorkspacePolicy(
  projectPolicy: ProjectExecutionWorkspacePolicy | null,
  isolatedWorkspacesEnabled: boolean,
): ProjectExecutionWorkspacePolicy | null {
  if (!isolatedWorkspacesEnabled) return null;
  return projectPolicy;
}

export function parseIssueExecutionWorkspaceSettings(raw: unknown): IssueExecutionWorkspaceSettings | null {
  const parsed = parseObject(raw);
  if (Object.keys(parsed).length === 0) return null;
  const workspaceStrategy = parseExecutionWorkspaceStrategy(parsed.workspaceStrategy);
  const mode = asString(parsed.mode, "");
  const normalizedMode = (() => {
    if (
      mode === "inherit" ||
      mode === "shared_workspace" ||
      mode === "isolated_workspace" ||
      mode === "operator_branch" ||
      mode === "reuse_existing" ||
      mode === "agent_default"
    ) {
      return mode;
    }
    if (mode === "project_primary") return "shared_workspace";
    if (mode === "isolated") return "isolated_workspace";
    return "";
  })();
  return {
    ...(normalizedMode
      ? { mode: normalizedMode as IssueExecutionWorkspaceSettings["mode"] }
      : {}),
    ...(workspaceStrategy ? { workspaceStrategy } : {}),
    ...(parsed.workspaceRuntime && typeof parsed.workspaceRuntime === "object" && !Array.isArray(parsed.workspaceRuntime)
      ? { workspaceRuntime: { ...(parsed.workspaceRuntime as Record<string, unknown>) } }
      : {}),
  };
}

export function defaultIssueExecutionWorkspaceSettingsForProject(
  projectPolicy: ProjectExecutionWorkspacePolicy | null,
): IssueExecutionWorkspaceSettings | null {
  if (!projectPolicy?.enabled) return null;
  return {
    mode:
      projectPolicy.defaultMode === "isolated_workspace"
        ? "isolated_workspace"
        : projectPolicy.defaultMode === "operator_branch"
          ? "operator_branch"
          : projectPolicy.defaultMode === "adapter_default"
            ? "agent_default"
            : "shared_workspace",
  };
}

export function resolveExecutionWorkspaceMode(input: {
  projectPolicy: ProjectExecutionWorkspacePolicy | null;
  issueSettings: IssueExecutionWorkspaceSettings | null;
  legacyUseProjectWorkspace: boolean | null;
}): ParsedExecutionWorkspaceMode {
  const issueMode = input.issueSettings?.mode;
  if (issueMode && issueMode !== "inherit" && issueMode !== "reuse_existing") {
    return issueMode;
  }
  if (input.projectPolicy?.enabled) {
    if (input.projectPolicy.defaultMode === "isolated_workspace") return "isolated_workspace";
    if (input.projectPolicy.defaultMode === "operator_branch") return "operator_branch";
    if (input.projectPolicy.defaultMode === "adapter_default") return "agent_default";
    return "shared_workspace";
  }
  if (input.legacyUseProjectWorkspace === false) {
    return "agent_default";
  }
  return "shared_workspace";
}

export function buildExecutionWorkspaceAdapterConfig(input: {
  agentConfig: Record<string, unknown>;
  projectPolicy: ProjectExecutionWorkspacePolicy | null;
  issueSettings: IssueExecutionWorkspaceSettings | null;
  mode: ParsedExecutionWorkspaceMode;
  legacyUseProjectWorkspace: boolean | null;
  swarmSubtask?: SwarmSubtask | null;
}): Record<string, unknown> {
  const nextConfig = { ...input.agentConfig };
  const guard = deriveSwarmWorkspaceGuard({
    mode: input.mode,
    subtask: input.swarmSubtask ?? null,
  });
  const effectiveMode = guard.enforcedMode;
  const projectHasPolicy = Boolean(input.projectPolicy?.enabled);
  const issueHasWorkspaceOverrides = Boolean(
    input.issueSettings?.mode ||
    input.issueSettings?.workspaceStrategy ||
    input.issueSettings?.workspaceRuntime,
  );
  const hasWorkspaceControl = projectHasPolicy || issueHasWorkspaceOverrides || input.legacyUseProjectWorkspace === false;

  if (hasWorkspaceControl) {
    if (effectiveMode === "isolated_workspace") {
      const baseStrategy =
        input.issueSettings?.workspaceStrategy ??
        input.projectPolicy?.workspaceStrategy ??
        parseExecutionWorkspaceStrategy(nextConfig.workspaceStrategy) ??
        ({ type: "git_worktree" } satisfies ExecutionWorkspaceStrategy);
      const strategy = applySwarmWorkspaceStrategy({
        strategy: baseStrategy,
        enforcedMode: effectiveMode,
        subtask: input.swarmSubtask ?? null,
      });
      nextConfig.workspaceStrategy = (strategy ?? baseStrategy) as unknown as Record<string, unknown>;
    } else {
      delete nextConfig.workspaceStrategy;
    }

    if (effectiveMode === "agent_default") {
      delete nextConfig.workspaceRuntime;
    } else if (input.issueSettings?.workspaceRuntime) {
      nextConfig.workspaceRuntime = cloneRecord(input.issueSettings.workspaceRuntime) ?? undefined;
    } else if (input.projectPolicy?.workspaceRuntime) {
      nextConfig.workspaceRuntime = cloneRecord(input.projectPolicy.workspaceRuntime) ?? undefined;
    }
  }

  if (guard.warnings.length > 0 || guard.errors.length > 0) {
    nextConfig.swarmWorkspaceGuard = {
      enforcedMode: effectiveMode,
      warnings: guard.warnings,
      errors: guard.errors,
    };
  } else {
    delete nextConfig.swarmWorkspaceGuard;
  }

  return nextConfig;
}

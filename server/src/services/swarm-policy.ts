import type {
  EvidencePolicy,
  EvidencePolicySource,
  OrchestrationPolicySnapshot,
  SwarmModelTier,
  SwarmPlan,
  SwarmSubtask,
} from "@paperclipai/shared";

export const DEFAULT_SWARM_MAX_CHILDREN = 16;

export type SwarmAdmissionReason =
  | "no_plan"
  | "too_few_subtasks"
  | "too_many_subtasks"
  | "duplicate_subtask_id"
  | "duplicate_task_key"
  | "admitted";

export type SwarmAdmissionDecision = {
  admitted: boolean;
  reason: SwarmAdmissionReason;
  subtaskCount: number;
  totalBudgetCents: number;
  modelTiers: SwarmModelTier[];
};

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  );
}

export function resolveSwarmModelTier(subtask: Pick<SwarmSubtask, "kind" | "recommendedModelTier">): SwarmModelTier {
  if (subtask.recommendedModelTier) return subtask.recommendedModelTier;
  if (subtask.kind === "review" || subtask.kind === "verification") return "premium";
  if (subtask.kind === "implementation") return "balanced";
  return "cheap";
}

export function shouldSwarm(input: {
  plan: SwarmPlan | null;
  maxChildren?: number;
}): SwarmAdmissionDecision {
  const maxChildren = input.maxChildren ?? DEFAULT_SWARM_MAX_CHILDREN;
  const subtasks = input.plan?.subtasks ?? [];
  const subtaskIds = uniqueNonEmpty(subtasks.map((subtask) => subtask.id));
  const taskKeys = uniqueNonEmpty(subtasks.map((subtask) => subtask.taskKey ?? null));
  const totalBudgetCents = subtasks.reduce((sum, subtask) => sum + Math.max(0, subtask.budgetCents ?? 0), 0);
  const modelTiers = uniqueNonEmpty(subtasks.map((subtask) => resolveSwarmModelTier(subtask))) as SwarmModelTier[];

  if (!input.plan) {
    return {
      admitted: false,
      reason: "no_plan",
      subtaskCount: 0,
      totalBudgetCents,
      modelTiers,
    };
  }
  if (subtasks.length < 2) {
    return {
      admitted: false,
      reason: "too_few_subtasks",
      subtaskCount: subtasks.length,
      totalBudgetCents,
      modelTiers,
    };
  }
  if (subtasks.length > maxChildren) {
    return {
      admitted: false,
      reason: "too_many_subtasks",
      subtaskCount: subtasks.length,
      totalBudgetCents,
      modelTiers,
    };
  }
  if (subtaskIds.length !== subtasks.length) {
    return {
      admitted: false,
      reason: "duplicate_subtask_id",
      subtaskCount: subtasks.length,
      totalBudgetCents,
      modelTiers,
    };
  }
  if (taskKeys.length !== subtasks.filter((subtask) => typeof subtask.taskKey === "string" && subtask.taskKey.trim().length > 0).length) {
    return {
      admitted: false,
      reason: "duplicate_task_key",
      subtaskCount: subtasks.length,
      totalBudgetCents,
      modelTiers,
    };
  }

  return {
    admitted: true,
    reason: "admitted",
    subtaskCount: subtasks.length,
    totalBudgetCents,
    modelTiers,
  };
}

export function resolveSwarmAdapterConfigOverride(
  adapterType: string,
  tier: SwarmModelTier,
): Record<string, unknown> | null {
  switch (adapterType) {
    case "codex_local":
      return {
        model:
          tier === "cheap"
            ? "gpt-5-mini"
            : tier === "premium"
              ? "gpt-5.4"
              : "gpt-5.3-codex",
      };
    case "cursor":
      return {
        model:
          tier === "cheap"
            ? "gpt-5.3-codex-low"
            : tier === "premium"
              ? "gpt-5.3-codex-high"
              : "gpt-5.3-codex",
      };
    case "claude_local":
      return {
        model:
          tier === "cheap"
            ? "claude-haiku-4-6"
            : tier === "premium"
              ? "claude-opus-4-6"
              : "claude-sonnet-4-6",
      };
    case "gemini_local":
      return {
        model:
          tier === "cheap"
            ? "gemini-2.5-flash-lite"
            : tier === "premium"
              ? "gemini-2.5-pro"
              : "gemini-2.5-flash",
      };
    default:
      return null;
  }
}

export function buildSwarmPolicySnapshot(input: {
  evidencePolicy: EvidencePolicy;
  evidencePolicySource: EvidencePolicySource;
  tier: SwarmModelTier;
  plannerRunId?: string | null;
  subtask?: SwarmSubtask | null;
  admission?: SwarmAdmissionDecision | null;
}): OrchestrationPolicySnapshot {
  return {
    evidencePolicy: input.evidencePolicy,
    evidencePolicySource: input.evidencePolicySource,
    swarmEnabled: true,
    swarmPlannerRunId: input.plannerRunId ?? null,
    swarmModelTier: input.tier,
    swarmSubtaskId: input.subtask?.id ?? null,
    swarmSubtaskKind: input.subtask?.kind ?? null,
    swarmBudgetCents: input.subtask?.budgetCents ?? null,
    swarmMaxRuntimeSec: input.subtask?.maxRuntimeSec ?? null,
    swarmAdmission: input.admission
      ? {
          admitted: input.admission.admitted,
          reason: input.admission.reason,
          subtaskCount: input.admission.subtaskCount,
          totalBudgetCents: input.admission.totalBudgetCents,
          modelTiers: input.admission.modelTiers,
        }
      : null,
  };
}

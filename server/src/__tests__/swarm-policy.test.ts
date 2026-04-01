import { describe, expect, it } from "vitest";
import {
  buildSwarmPolicySnapshot,
  resolveSwarmAdapterConfigOverride,
  resolveSwarmModelTier,
  shouldSwarm,
} from "../services/swarm-policy.js";

describe("swarm-policy", () => {
  it("admits multi-subtask swarm plans and summarizes budget + tiers", () => {
    const decision = shouldSwarm({
      plan: {
        version: "v1",
        subtasks: [
          {
            id: "subtask-1",
            kind: "research",
            title: "Inspect logs",
            goal: "Read the logs.",
            taskKey: "inspect-logs",
            expectedArtifacts: [{ kind: "summary", required: true }],
            acceptanceChecks: ["Logs summarized."],
            recommendedModelTier: "cheap",
            budgetCents: 10,
          },
          {
            id: "subtask-2",
            kind: "review",
            title: "Review findings",
            goal: "Review the findings.",
            taskKey: "review-findings",
            expectedArtifacts: [{ kind: "comment", required: true }],
            acceptanceChecks: ["Review completed."],
            recommendedModelTier: "premium",
            budgetCents: 25,
          },
        ],
      },
    });

    expect(decision).toEqual({
      admitted: true,
      reason: "admitted",
      subtaskCount: 2,
      totalBudgetCents: 35,
      modelTiers: ["cheap", "premium"],
    });
  });

  it("rejects single-subtask plans", () => {
    const decision = shouldSwarm({
      plan: {
        version: "v1",
        subtasks: [
          {
            id: "subtask-1",
            kind: "research",
            title: "Only one task",
            goal: "Gather one thing.",
            taskKey: "single-task",
            expectedArtifacts: [{ kind: "summary", required: true }],
            acceptanceChecks: ["Evidence present."],
            recommendedModelTier: "cheap",
          },
        ],
      },
    });

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toBe("too_few_subtasks");
  });

  it("maps swarm model tiers into adapter-specific model overrides", () => {
    expect(resolveSwarmModelTier({ kind: "verification", recommendedModelTier: "premium" })).toBe("premium");
    expect(resolveSwarmAdapterConfigOverride("codex_local", "cheap")).toEqual({ model: "gpt-5-mini" });
    expect(resolveSwarmAdapterConfigOverride("codex_local", "balanced")).toEqual({ model: "gpt-5.3-codex" });
    expect(resolveSwarmAdapterConfigOverride("codex_local", "premium")).toEqual({ model: "gpt-5.4" });
    expect(resolveSwarmAdapterConfigOverride("claude_local", "cheap")).toEqual({ model: "claude-haiku-4-6" });
  });

  it("embeds swarm routing metadata into orchestration policy snapshots", () => {
    const snapshot = buildSwarmPolicySnapshot({
      evidencePolicy: "code_ci_evaluator_summary",
      evidencePolicySource: "company_default",
      tier: "cheap",
      plannerRunId: "planner-1",
      subtask: {
        id: "subtask-1",
        kind: "research",
        title: "Inspect logs",
        goal: "Read the logs.",
        taskKey: "inspect-logs",
        expectedArtifacts: [{ kind: "summary", required: true }],
        acceptanceChecks: ["Logs summarized."],
        recommendedModelTier: "cheap",
        budgetCents: 15,
        maxRuntimeSec: 120,
      },
      admission: {
        admitted: true,
        reason: "admitted",
        subtaskCount: 2,
        totalBudgetCents: 35,
        modelTiers: ["cheap", "premium"],
      },
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        evidencePolicy: "code_ci_evaluator_summary",
        evidencePolicySource: "company_default",
        swarmEnabled: true,
        swarmPlannerRunId: "planner-1",
        swarmModelTier: "cheap",
        swarmSubtaskId: "subtask-1",
        swarmSubtaskKind: "research",
        swarmBudgetCents: 15,
        swarmMaxRuntimeSec: 120,
      }),
    );
  });
});

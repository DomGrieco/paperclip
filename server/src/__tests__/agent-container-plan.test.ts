import { describe, expect, it } from "vitest";
import type { RuntimeBundle } from "@paperclipai/shared";
import { buildAgentContainerLaunchPlan } from "../services/agent-container-plan.js";
import { getAgentContainerProfile } from "../services/agent-container-profiles.js";

function buildRuntimeBundle(): RuntimeBundle {
  return {
    runtime: "hermes",
    company: { id: "company-1" },
    agent: { id: "agent-1", name: "Worker", adapterType: "hermes_local" },
    project: {
      id: "project-1",
      name: "Paperclip",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "isolated_workspace",
        workspaceStrategy: { type: "git_worktree" },
      },
    },
    issue: {
      id: "issue-1",
      identifier: "DMG-1",
      title: "Build container plan",
      status: "todo",
      priority: "high",
    },
    run: {
      id: "run-1",
      runType: "task",
      rootRunId: "run-1",
      parentRunId: null,
      graphDepth: 0,
      repairAttempt: 0,
      verificationVerdict: null,
    },
    policy: {
      tddMode: "required",
      evidencePolicy: "code_ci_evaluator_summary_artifacts",
      evidencePolicySource: "issue",
      maxRepairAttempts: 3,
      requiresHumanArtifacts: true,
    },
    runner: {
      target: "local_host",
      provider: "local_process",
      workspaceStrategyType: "git_worktree",
      executionMode: "isolated_workspace",
      browserCapable: false,
      sandboxed: false,
      isolationBoundary: "host_process",
    },
    verification: {
      required: true,
      requiresEvaluatorSummary: true,
      requiresArtifacts: true,
      latestVerificationRunId: null,
      reviewReadyAt: null,
      runner: {
        target: "cloud_sandbox",
        provider: "cloud_sandbox",
        workspaceStrategyType: "git_worktree",
        executionMode: "isolated_workspace",
        browserCapable: true,
        sandboxed: true,
        isolationBoundary: "cloud_sandbox",
      },
    },
    swarm: null,
    memory: { snippets: [] },
    projection: {
      runtime: "hermes",
      contextKey: "paperclipRuntimeBundle",
      envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON",
      materializationRoot: ".paperclip/runtime",
    },
  };
}

describe("agent container profiles", () => {
  it("defines Hermes, Codex, and Cursor container profiles", () => {
    expect(getAgentContainerProfile("hermes_local")).toMatchObject({
      adapterType: "hermes_local",
      nativeHomePath: "/home/hermes/.hermes",
      nativeSkillsPath: "/home/hermes/.hermes/skills",
    });
    expect(getAgentContainerProfile("codex_local")).toMatchObject({
      adapterType: "codex_local",
      nativeHomePath: "/home/codex/.codex",
      nativeSkillsPath: "/home/codex/.codex/skills",
    });
    expect(getAgentContainerProfile("cursor_local")).toMatchObject({
      adapterType: "cursor_local",
      nativeHomePath: "/home/cursor/.cursor",
      nativeSkillsPath: "/home/cursor/.cursor/skills",
    });
  });
});

describe("buildAgentContainerLaunchPlan", () => {
  it("builds a generic Hermes container launch plan from the Hermes profile", () => {
    const plan = buildAgentContainerLaunchPlan({
      adapterType: "hermes_local",
      runId: "run-1",
      agentId: "agent-1",
      executionWorkspaceCwd: "/tmp/paperclip/workspaces/dmg-1",
      runtimeBundle: buildRuntimeBundle(),
      executionConfig: {
        command: "hermes",
        provider: "openai-codex",
        model: "gpt-5.3-codex",
        env: {
          HERMES_HOME: "/tmp/paperclip/workspaces/dmg-1/.paperclip/hermes-home",
          PAPERCLIP_RUNTIME_ROOT: "/tmp/paperclip/workspaces/dmg-1/.paperclip/runtime",
          PAPERCLIP_RUNTIME_BUNDLE_PATH: "/tmp/paperclip/workspaces/dmg-1/.paperclip/runtime/bundle.json",
          PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH: "/tmp/paperclip/workspaces/dmg-1/.paperclip/runtime/instructions.md",
          PAPERCLIP_API_HELPER_PATH: "/tmp/paperclip/workspaces/dmg-1/.paperclip/runtime/paperclip-api",
          PAPERCLIP_SHARED_CONTEXT_PATH: "/tmp/paperclip/workspaces/dmg-1/.paperclip/context/shared-context.json",
          PAPERCLIP_HERMES_MANAGED_RUNTIME_ROOT:
            "/tmp/paperclip/runtime-cache/hermes/channels/stable/installs/current",
          PAPERCLIP_HERMES_MANAGED_RUNTIME_HERMES_COMMAND:
            "/tmp/paperclip/runtime-cache/hermes/channels/stable/installs/current/venv/bin/hermes",
          PAPERCLIP_API_KEY: "secret-token",
        },
      },
    });

    expect(plan.adapterType).toBe("hermes_local");
    expect(plan.runner).toEqual({
      target: "hermes_container",
      provider: "hermes_container",
      workspaceStrategyType: "git_worktree",
      executionMode: "isolated_workspace",
      browserCapable: false,
      sandboxed: true,
      isolationBoundary: "container_process",
    });
    expect(plan.nativeHomePath).toBe("/home/hermes/.hermes");
    expect(plan.nativeSkillsPath).toBe("/home/hermes/.hermes/skills");
    expect(plan.command).toEqual(["/paperclip/runtime/hermes-managed/venv/bin/hermes"]);
    expect(plan.mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workspace", containerPath: "/workspace" }),
        expect.objectContaining({ kind: "agent_home", containerPath: "/home/hermes/.hermes" }),
        expect.objectContaining({ kind: "runtime_bundle", containerPath: "/workspace/.paperclip/runtime" }),
        expect.objectContaining({ kind: "managed_runtime", containerPath: "/paperclip/runtime/hermes-managed" }),
      ]),
    );
    expect(plan.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "HERMES_HOME", value: "/home/hermes/.hermes", source: "worker_home" }),
        expect.objectContaining({
          name: "PAPERCLIP_HERMES_MANAGED_RUNTIME_HERMES_COMMAND",
          value: "/paperclip/runtime/hermes-managed/venv/bin/hermes",
          source: "managed_runtime",
        }),
      ]),
    );
  });
});

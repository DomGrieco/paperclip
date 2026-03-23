import { describe, expect, it } from "vitest";
import type { RuntimeBundle } from "@paperclipai/shared";
import { buildHermesContainerLaunchPlan } from "../services/hermes-container-plan.js";

function buildRuntimeBundle(): RuntimeBundle {
  return {
    runtime: "hermes",
    company: { id: "company-1" },
    agent: { id: "agent-1", name: "Hermes Worker", adapterType: "hermes_local" },
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
      title: "Build hermes container plan",
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
    memory: { snippets: [] },
    projection: {
      runtime: "hermes",
      contextKey: "paperclipRuntimeBundle",
      envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON",
      materializationRoot: ".paperclip/runtime",
    },
  };
}

describe("buildHermesContainerLaunchPlan", () => {
  it("derives a hermes container launch contract from resolved execution config", () => {
    const plan = buildHermesContainerLaunchPlan({
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
          PAPERCLIP_HERMES_SHARED_HOME_SOURCE: "/paperclip/shared/hermes-home-source",
          PAPERCLIP_API_KEY: "secret-token",
        },
      },
    });

    expect(plan.runner).toEqual({
      target: "hermes_container",
      provider: "hermes_container",
      workspaceStrategyType: "git_worktree",
      executionMode: "isolated_workspace",
      browserCapable: false,
      sandboxed: true,
      isolationBoundary: "container_process",
    });
    expect(plan.image).toBe("paperclip/hermes-worker:dev");
    expect(plan.command).toEqual(["hermes"]);
    expect(plan.workingDir).toBe("/workspace");
    expect(plan.workspacePath).toBe("/workspace");
    expect(plan.agentHomePath).toBe("/home/hermes/.hermes");
    expect(plan.sharedAuthSourcePath).toBe("/paperclip/shared/hermes-home-source");
    expect(plan.runtimeBundleRoot).toBe("/workspace/.paperclip/runtime");
    expect(plan.sharedContextPath).toBe("/workspace/.paperclip/context/shared-context.json");
    expect(plan.provider).toBe("openai-codex");
    expect(plan.model).toBe("gpt-5.3-codex");
    expect(plan.mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "workspace",
          hostPath: "/tmp/paperclip/workspaces/dmg-1",
          containerPath: "/workspace",
          readOnly: false,
        }),
        expect.objectContaining({
          kind: "agent_home",
          containerPath: "/home/hermes/.hermes",
          readOnly: false,
        }),
        expect.objectContaining({
          kind: "runtime_bundle",
          containerPath: "/workspace/.paperclip/runtime",
          readOnly: true,
        }),
        expect.objectContaining({
          kind: "shared_auth",
          containerPath: "/paperclip/shared/hermes-home-source",
          readOnly: true,
        }),
      ]),
    );
    expect(plan.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "HERMES_HOME",
          value: "/home/hermes/.hermes",
          source: "worker_home",
        }),
        expect.objectContaining({
          name: "PAPERCLIP_RUNTIME_ROOT",
          value: "/workspace/.paperclip/runtime",
          source: "runtime_bundle",
        }),
        expect.objectContaining({
          name: "PAPERCLIP_RUNTIME_BUNDLE_PATH",
          value: "/workspace/.paperclip/runtime/bundle.json",
          source: "runtime_bundle",
        }),
        expect.objectContaining({
          name: "PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH",
          value: "/workspace/.paperclip/runtime/instructions.md",
          source: "runtime_bundle",
        }),
        expect.objectContaining({
          name: "PAPERCLIP_API_HELPER_PATH",
          value: "/workspace/.paperclip/runtime/paperclip-api",
          source: "runtime_bundle",
        }),
        expect.objectContaining({
          name: "PAPERCLIP_SHARED_CONTEXT_PATH",
          value: "/workspace/.paperclip/context/shared-context.json",
          source: "runtime_bundle",
        }),
        expect.objectContaining({
          name: "PAPERCLIP_API_KEY",
          secret: true,
          source: "paperclip_runtime",
        }),
      ]),
    );
    expect(plan.runtimeService).toEqual({
      serviceName: "hermes-worker",
      provider: "hermes_container",
      scopeType: "run",
      scopeId: "run-1",
      ownerAgentId: "agent-1",
    });
  });

  it("falls back cleanly when runtime bundle materialization is absent", () => {
    const plan = buildHermesContainerLaunchPlan({
      runId: "run-2",
      agentId: "agent-2",
      executionWorkspaceCwd: "/tmp/paperclip/workspaces/no-bundle",
      runtimeBundle: null,
      executionConfig: {
        env: {},
      },
    });

    expect(plan.runtimeBundleRoot).toBeNull();
    expect(plan.sharedContextPath).toBeNull();
    expect(plan.mounts.some((mount) => mount.kind === "runtime_bundle")).toBe(false);
    expect(plan.command).toEqual(["hermes"]);
  });
});

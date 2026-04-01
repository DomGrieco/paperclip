import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBundle } from "@paperclipai/shared";
import { buildAgentContainerLaunchPlan } from "../services/agent-container-plan.js";
import { getAgentContainerProfile } from "../services/agent-container-profiles.js";

beforeEach(() => {
  vi.stubEnv("PAPERCLIP_HOME", "/Users/test/.paperclip");
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    expect(getAgentContainerProfile("cursor")).toMatchObject({
      adapterType: "cursor",
      nativeHomePath: "/home/cursor",
      nativeSkillsPath: "/home/cursor/.cursor/skills",
    });
    expect(getAgentContainerProfile("cursor_local")).toMatchObject({
      adapterType: "cursor",
      nativeHomePath: "/home/cursor",
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

  it("remaps Codex managed runtime paths into the codex worker container", () => {
    const plan = buildAgentContainerLaunchPlan({
      adapterType: "codex_local",
      runId: "run-codex",
      agentId: "agent-codex",
      executionWorkspaceCwd: "/tmp/paperclip/workspaces/codex-1",
      runtimeBundle: buildRuntimeBundle(),
      executionConfig: {
        command: "/tmp/paperclip/runtime-cache/codex_local/channels/stable/installs/current/bin/codex",
        env: {
          CODEX_HOME: "/tmp/paperclip/workspaces/codex-1/.paperclip/codex-home",
          PAPERCLIP_RUNTIME_ROOT: "/tmp/paperclip/workspaces/codex-1/.paperclip/runtime",
          PAPERCLIP_RUNTIME_BUNDLE_PATH: "/tmp/paperclip/workspaces/codex-1/.paperclip/runtime/bundle.json",
          PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH: "/tmp/paperclip/workspaces/codex-1/.paperclip/runtime/instructions.md",
          PAPERCLIP_API_HELPER_PATH: "/tmp/paperclip/workspaces/codex-1/.paperclip/runtime/paperclip-api",
          PAPERCLIP_SHARED_CONTEXT_PATH: "/tmp/paperclip/workspaces/codex-1/.paperclip/context/shared-context.json",
          PAPERCLIP_CODEX_MANAGED_RUNTIME_ROOT:
            "/tmp/paperclip/runtime-cache/codex_local/channels/stable/installs/current",
          PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND:
            "/tmp/paperclip/runtime-cache/codex_local/channels/stable/installs/current/bin/codex",
          PAPERCLIP_CODEX_SHARED_HOME_SOURCE: "/paperclip/shared/codex-home-source",
        },
      },
    });

    expect(plan.runner.provider).toBe("agent_container");
    expect(plan.command).toEqual(["/paperclip/runtime/codex-managed/bin/codex"]);
    expect(plan.mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_home",
          hostPath: "/Users/test/.paperclip/instances/default/companies/company-1/agents/agent-codex/homes/codex_local",
          containerPath: "/home/codex/.codex",
        }),
        expect.objectContaining({ kind: "managed_runtime", containerPath: "/paperclip/runtime/codex-managed" }),
      ]),
    );
    expect(plan.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "CODEX_HOME", value: "/home/codex/.codex", source: "worker_home" }),
        expect.objectContaining({
          name: "PAPERCLIP_CODEX_MANAGED_RUNTIME_ROOT",
          value: "/paperclip/runtime/codex-managed",
          source: "managed_runtime",
        }),
        expect.objectContaining({
          name: "PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND",
          value: "/paperclip/runtime/codex-managed/bin/codex",
          source: "managed_runtime",
        }),
      ]),
    );
  });

  it("remaps Cursor managed runtime and HOME into the cursor worker container", () => {
    const plan = buildAgentContainerLaunchPlan({
      adapterType: "cursor",
      runId: "run-cursor",
      agentId: "agent-cursor",
      executionWorkspaceCwd: "/tmp/paperclip/workspaces/cursor-1",
      runtimeBundle: buildRuntimeBundle(),
      executionConfig: {
        command: "/tmp/paperclip/runtime-cache/cursor/channels/stable/install-home/.local/bin/agent",
        env: {
          HOME: "/tmp/paperclip/workspaces/cursor-1/.paperclip/cursor-home",
          PAPERCLIP_RUNTIME_ROOT: "/tmp/paperclip/workspaces/cursor-1/.paperclip/runtime",
          PAPERCLIP_RUNTIME_BUNDLE_PATH: "/tmp/paperclip/workspaces/cursor-1/.paperclip/runtime/bundle.json",
          PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH: "/tmp/paperclip/workspaces/cursor-1/.paperclip/runtime/instructions.md",
          PAPERCLIP_API_HELPER_PATH: "/tmp/paperclip/workspaces/cursor-1/.paperclip/runtime/paperclip-api",
          PAPERCLIP_SHARED_CONTEXT_PATH: "/tmp/paperclip/workspaces/cursor-1/.paperclip/context/shared-context.json",
          PAPERCLIP_CURSOR_MANAGED_RUNTIME_ROOT:
            "/tmp/paperclip/runtime-cache/cursor/channels/stable/install-home",
          PAPERCLIP_CURSOR_MANAGED_RUNTIME_COMMAND:
            "/tmp/paperclip/runtime-cache/cursor/channels/stable/install-home/.local/bin/agent",
        },
      },
    });

    expect(plan.runner.provider).toBe("agent_container");
    expect(plan.command).toEqual(["/paperclip/runtime/cursor-managed/.local/bin/agent"]);
    expect(plan.mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_home",
          hostPath: "/Users/test/.paperclip/instances/default/companies/company-1/agents/agent-cursor/homes/cursor",
          containerPath: "/home/cursor",
        }),
        expect.objectContaining({ kind: "managed_runtime", containerPath: "/paperclip/runtime/cursor-managed" }),
      ]),
    );
    expect(plan.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "HOME", value: "/home/cursor", source: "worker_home" }),
        expect.objectContaining({
          name: "PAPERCLIP_CURSOR_MANAGED_RUNTIME_ROOT",
          value: "/paperclip/runtime/cursor-managed",
          source: "managed_runtime",
        }),
        expect.objectContaining({
          name: "PAPERCLIP_CURSOR_MANAGED_RUNTIME_COMMAND",
          value: "/paperclip/runtime/cursor-managed/.local/bin/agent",
          source: "managed_runtime",
        }),
      ]),
    );
  });
});

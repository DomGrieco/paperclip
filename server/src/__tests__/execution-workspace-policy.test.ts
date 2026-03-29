import { describe, expect, it } from "vitest";
import {
  buildExecutionWorkspaceAdapterConfig,
  defaultIssueExecutionWorkspaceSettingsForProject,
  gateProjectExecutionWorkspacePolicy,
  deriveSwarmWorkspaceGuard,
  parseIssueExecutionWorkspaceSettings,
  parseProjectExecutionWorkspacePolicy,
  resolveExecutionWorkspaceMode,
} from "../services/execution-workspace-policy.ts";

describe("execution workspace policy helpers", () => {
  it("defaults new issue settings from enabled project policy", () => {
    expect(
      defaultIssueExecutionWorkspaceSettingsForProject({
        enabled: true,
        defaultMode: "isolated_workspace",
      }),
    ).toEqual({ mode: "isolated_workspace" });
    expect(
      defaultIssueExecutionWorkspaceSettingsForProject({
        enabled: true,
        defaultMode: "shared_workspace",
      }),
    ).toEqual({ mode: "shared_workspace" });
    expect(defaultIssueExecutionWorkspaceSettingsForProject(null)).toBeNull();
  });

  it("prefers explicit issue mode over project policy and legacy overrides", () => {
    expect(
      resolveExecutionWorkspaceMode({
        projectPolicy: { enabled: true, defaultMode: "shared_workspace" },
        issueSettings: { mode: "isolated_workspace" },
        legacyUseProjectWorkspace: false,
      }),
    ).toBe("isolated_workspace");
  });

  it("falls back to project policy before legacy project-workspace compatibility flag", () => {
    expect(
      resolveExecutionWorkspaceMode({
        projectPolicy: { enabled: true, defaultMode: "isolated_workspace" },
        issueSettings: null,
        legacyUseProjectWorkspace: false,
      }),
    ).toBe("isolated_workspace");
    expect(
      resolveExecutionWorkspaceMode({
        projectPolicy: null,
        issueSettings: null,
        legacyUseProjectWorkspace: false,
      }),
    ).toBe("agent_default");
  });

  it("applies project policy strategy and runtime defaults when isolation is enabled", () => {
    const result = buildExecutionWorkspaceAdapterConfig({
      agentConfig: {
        workspaceStrategy: { type: "project_primary" },
      },
      projectPolicy: {
        enabled: true,
        defaultMode: "isolated_workspace",
        workspaceStrategy: {
          type: "git_worktree",
          baseRef: "origin/main",
          provisionCommand: "bash ./scripts/provision-worktree.sh",
        },
        workspaceRuntime: {
          services: [{ name: "web", command: "pnpm dev" }],
        },
      },
      issueSettings: null,
      mode: "isolated_workspace",
      legacyUseProjectWorkspace: null,
    });

    expect(result.workspaceStrategy).toEqual({
      type: "git_worktree",
      baseRef: "origin/main",
      provisionCommand: "bash ./scripts/provision-worktree.sh",
    });
    expect(result.workspaceRuntime).toEqual({
      services: [{ name: "web", command: "pnpm dev" }],
    });
  });

  it("clears managed workspace strategy when issue opts out to project primary or agent default", () => {
    const baseConfig = {
      workspaceStrategy: { type: "git_worktree", branchTemplate: "{{issue.identifier}}" },
      workspaceRuntime: { services: [{ name: "web" }] },
    };

    expect(
      buildExecutionWorkspaceAdapterConfig({
        agentConfig: baseConfig,
        projectPolicy: { enabled: true, defaultMode: "isolated_workspace" },
        issueSettings: { mode: "shared_workspace" },
        mode: "shared_workspace",
        legacyUseProjectWorkspace: null,
      }).workspaceStrategy,
    ).toBeUndefined();

    const agentDefault = buildExecutionWorkspaceAdapterConfig({
      agentConfig: baseConfig,
      projectPolicy: null,
      issueSettings: { mode: "agent_default" },
      mode: "agent_default",
      legacyUseProjectWorkspace: null,
    });
    expect(agentDefault.workspaceStrategy).toBeUndefined();
    expect(agentDefault.workspaceRuntime).toBeUndefined();
  });

  it("forces isolated swarm implementation workers onto subtask-scoped worktree branches", () => {
    const result = buildExecutionWorkspaceAdapterConfig({
      agentConfig: {
        workspaceStrategy: { type: "git_worktree", branchTemplate: "{{issue.identifier}}-{{slug}}" },
      },
      projectPolicy: { enabled: true, defaultMode: "shared_workspace" },
      issueSettings: { mode: "shared_workspace" },
      mode: "shared_workspace",
      legacyUseProjectWorkspace: null,
      swarmSubtask: {
        id: "worker-heartbeat-ui",
        kind: "implementation",
        title: "Update heartbeat UI labels",
        goal: "Render request/start states distinctly in the issue timeline.",
        taskKey: "heartbeat-ui",
        allowedPaths: ["ui/src/components/ActivityRow.tsx"],
        ownershipMode: "exclusive",
        expectedArtifacts: [{ kind: "patch", required: true }],
        acceptanceChecks: ["UI shows heartbeat.requested and heartbeat.started distinctly."],
        recommendedModelTier: "balanced",
      },
    });

    expect(result.workspaceStrategy).toEqual({
      type: "git_worktree",
      branchTemplate: "{{issue.identifier}}-{{slug}}-heartbeat-ui",
    });
    expect(result.swarmWorkspaceGuard).toEqual({
      enforcedMode: "isolated_workspace",
      warnings: [
        "Swarm subtask worker-heartbeat-ui forced into an isolated workspace to avoid parallel edit collisions.",
      ],
      errors: [],
    });
  });

  it("flags shared-workspace ownership conflicts when exclusive subtasks omit allowed paths", () => {
    expect(
      deriveSwarmWorkspaceGuard({
        mode: "shared_workspace",
        subtask: {
          id: "worker-unbounded",
          kind: "implementation",
          title: "Unbounded edit",
          goal: "Touch whatever seems necessary.",
          ownershipMode: "exclusive",
          expectedArtifacts: [{ kind: "patch", required: true }],
          acceptanceChecks: ["Done"],
          recommendedModelTier: "balanced",
        },
      }),
    ).toEqual({
      enforcedMode: "isolated_workspace",
      warnings: [
        "Swarm subtask worker-unbounded forced into an isolated workspace to avoid parallel edit collisions.",
      ],
      errors: [],
    });

    expect(
      deriveSwarmWorkspaceGuard({
        mode: "shared_workspace",
        subtask: {
          id: "verify-overlap",
          kind: "verification",
          title: "Verify overlap",
          goal: "Check path policy.",
          allowedPaths: ["ui/src/components/ActivityRow.tsx"],
          forbiddenPaths: ["ui/src/components/ActivityRow.tsx"],
          ownershipMode: "advisory",
          expectedArtifacts: [{ kind: "test_result", required: true }],
          acceptanceChecks: ["Done"],
          recommendedModelTier: "premium",
        },
      }).errors,
    ).toEqual([
      "Swarm subtask verify-overlap has overlapping allowedPaths/forbiddenPaths entries: ui/src/components/ActivityRow.tsx.",
    ]);
  });

  it("parses persisted JSON payloads into typed project and issue workspace settings", () => {
    expect(
      parseProjectExecutionWorkspacePolicy({
        enabled: true,
        defaultMode: "isolated",
        workspaceStrategy: {
          type: "git_worktree",
          worktreeParentDir: ".paperclip/worktrees",
          provisionCommand: "bash ./scripts/provision-worktree.sh",
          teardownCommand: "bash ./scripts/teardown-worktree.sh",
        },
      }),
    ).toEqual({
      enabled: true,
      defaultMode: "isolated_workspace",
      workspaceStrategy: {
        type: "git_worktree",
        worktreeParentDir: ".paperclip/worktrees",
        provisionCommand: "bash ./scripts/provision-worktree.sh",
        teardownCommand: "bash ./scripts/teardown-worktree.sh",
      },
    });
    expect(
      parseIssueExecutionWorkspaceSettings({
        mode: "project_primary",
      }),
    ).toEqual({
      mode: "shared_workspace",
    });
  });

  it("disables project execution workspace policy when the instance flag is off", () => {
    expect(
      gateProjectExecutionWorkspacePolicy(
        { enabled: true, defaultMode: "isolated_workspace" },
        false,
      ),
    ).toBeNull();
    expect(
      gateProjectExecutionWorkspacePolicy(
        { enabled: true, defaultMode: "isolated_workspace" },
        true,
      ),
    ).toEqual({ enabled: true, defaultMode: "isolated_workspace" });
  });
});

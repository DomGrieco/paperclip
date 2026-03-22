import { describe, expect, it } from "vitest";
import { resolveObservedRunnerSnapshot, resolvePlannedRunnerSnapshot } from "../services/runner-plane.js";

describe("runner-plane", () => {
  it("derives a planned local-host runner snapshot by default", () => {
    expect(resolvePlannedRunnerSnapshot(null)).toEqual({
      target: "local_host",
      provider: "local_process",
      workspaceStrategyType: null,
      executionMode: null,
      browserCapable: false,
      sandboxed: false,
      isolationBoundary: "host_process",
    });
  });

  it("derives a cloud sandbox planned runner snapshot from project policy", () => {
    expect(
      resolvePlannedRunnerSnapshot({
        defaultMode: "isolated_workspace",
        workspaceStrategy: { type: "cloud_sandbox" },
      }),
    ).toEqual({
      target: "cloud_sandbox",
      provider: "cloud_sandbox",
      workspaceStrategyType: "cloud_sandbox",
      executionMode: "isolated_workspace",
      browserCapable: true,
      sandboxed: true,
      isolationBoundary: "cloud_sandbox",
    });
  });

  it("upgrades the observed runner snapshot when adapter-managed runtime services are returned", () => {
    const planned = resolvePlannedRunnerSnapshot({
      defaultMode: "isolated_workspace",
      workspaceStrategy: { type: "git_worktree" },
    });

    expect(
      resolveObservedRunnerSnapshot({
        planned,
        runtimeServices: [
          {
            id: "svc-1",
            companyId: "company-1",
            projectId: null,
            projectWorkspaceId: null,
            executionWorkspaceId: null,
            issueId: null,
            serviceName: "preview",
            status: "running",
            lifecycle: "ephemeral",
            scopeType: "run",
            scopeId: "run-1",
            reuseKey: null,
            command: null,
            cwd: null,
            port: null,
            url: "https://preview.example.test",
            provider: "adapter_managed",
            providerRef: "sandbox-1",
            ownerAgentId: null,
            startedByRunId: "run-1",
            lastUsedAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            stoppedAt: null,
            stopPolicy: null,
            healthStatus: "healthy",
            reused: false,
          },
        ],
      }),
    ).toEqual({
      target: "adapter_managed",
      provider: "adapter_managed",
      workspaceStrategyType: "git_worktree",
      executionMode: "isolated_workspace",
      browserCapable: true,
      sandboxed: true,
      isolationBoundary: "adapter_runtime",
    });
  });
});

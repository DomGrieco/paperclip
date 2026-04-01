import { describe, expect, it, vi } from "vitest";
import {
  prepareCodexAdapterConfigForExecution,
  injectCodexContainerExecConfig,
} from "../services/codex-runtime.js";

vi.mock("../services/codex-managed-runtime.js", () => ({
  ensureManagedCodexRuntime: vi.fn(async () => ({
    schemaVersion: "v1",
    channel: "stable",
    source: "@openai/codex@latest",
    installRoot: "/tmp/paperclip/runtime-cache/codex/stable/current",
    commandPath: "/tmp/paperclip/runtime-cache/codex/stable/current/bin/codex",
    version: "Codex CLI 1.2.3",
    checkedAt: "2026-03-31T22:00:00.000Z",
    updatedAt: "2026-03-31T22:00:00.000Z",
    refreshIntervalMinutes: 360,
    refreshed: true,
  })),
}));

describe("prepareCodexAdapterConfigForExecution", () => {
  it("injects managed Codex runtime env and command when command is not explicitly configured", async () => {
    const nextConfig = await prepareCodexAdapterConfigForExecution({
      config: {
        env: {
          CODEX_HOME: "/tmp/paperclip/codex-home",
        },
      },
    });

    expect(nextConfig.command).toBe("/tmp/paperclip/runtime-cache/codex/stable/current/bin/codex");
    expect(nextConfig.env).toMatchObject({
      CODEX_HOME: "/tmp/paperclip/codex-home",
      PAPERCLIP_CODEX_MANAGED_RUNTIME_ROOT: "/tmp/paperclip/runtime-cache/codex/stable/current",
      PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND: "/tmp/paperclip/runtime-cache/codex/stable/current/bin/codex",
      PAPERCLIP_CODEX_MANAGED_RUNTIME_VERSION: "Codex CLI 1.2.3",
      PAPERCLIP_CODEX_MANAGED_RUNTIME_CHANNEL: "stable",
      PAPERCLIP_CODEX_MANAGED_RUNTIME_SOURCE: "@openai/codex@latest",
      PAPERCLIP_CODEX_MANAGED_RUNTIME_REFRESHED: "true",
    });
  });

  it("does not override an explicit command", async () => {
    const nextConfig = await prepareCodexAdapterConfigForExecution({
      config: {
        command: "/usr/local/bin/custom-codex",
        env: {},
      },
    });

    expect(nextConfig.command).toBe("/usr/local/bin/custom-codex");
    expect(nextConfig.env).not.toHaveProperty("PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND");
  });
});

describe("injectCodexContainerExecConfig", () => {
  it("switches the host command to the generic container-exec wrapper while preserving host-side env", () => {
    const nextConfig = injectCodexContainerExecConfig({
      config: {
        command: "/tmp/paperclip/runtime-cache/codex/stable/current/bin/codex",
        env: {
          CODEX_HOME: "/tmp/paperclip/workspaces/run-1/.paperclip/codex-home",
          PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND: "/tmp/paperclip/runtime-cache/codex/stable/current/bin/codex",
        },
      },
      containerId: "container-123",
      plan: {
        version: "v1",
        adapterType: "codex_local",
        runner: {
          target: "agent_container",
          provider: "agent_container",
          workspaceStrategyType: "git_worktree",
          executionMode: "isolated_workspace",
          browserCapable: false,
          sandboxed: true,
          isolationBoundary: "container_process",
        },
        image: "paperclip/codex-worker:dev",
        command: ["/paperclip/runtime/codex-managed/bin/codex"],
        workingDir: "/workspace",
        workspacePath: "/workspace",
        nativeHomePath: "/home/codex/.codex",
        nativeSkillsPath: "/home/codex/.codex/skills",
        agentHomePath: "/home/codex/.codex",
        sharedAuthSourcePath: null,
        runtimeBundleRoot: "/workspace/.paperclip/runtime",
        sharedContextPath: "/workspace/.paperclip/context/shared-context.json",
        provider: null,
        model: null,
        mounts: [],
        env: [
          { name: "CODEX_HOME", value: "/home/codex/.codex", secret: false, source: "worker_home" },
          { name: "PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND", value: "/paperclip/runtime/codex-managed/bin/codex", secret: false, source: "managed_runtime" },
          { name: "PAPERCLIP_CODEX_MANAGED_RUNTIME_ROOT", value: "/paperclip/runtime/codex-managed", secret: false, source: "managed_runtime" },
          { name: "PAPERCLIP_RUNTIME_ROOT", value: "/workspace/.paperclip/runtime", secret: false, source: "runtime_bundle" },
        ],
        runtimeService: {
          serviceName: "codex-worker",
          provider: "agent_container",
          scopeType: "run",
          scopeId: "run-1",
          ownerAgentId: "agent-1",
        },
      },
    });

    expect(String(nextConfig.command)).toContain("server/scripts/agent-container-exec.js");
    expect(String(nextConfig.command)).not.toContain("server/server/scripts/agent-container-exec.js");
    expect(nextConfig.env).toMatchObject({
      CODEX_HOME: "/tmp/paperclip/workspaces/run-1/.paperclip/codex-home",
      PAPERCLIP_AGENT_CONTAINER_ID: "container-123",
      PAPERCLIP_AGENT_CONTAINER_COMMAND: "/paperclip/runtime/codex-managed/bin/codex",
      PAPERCLIP_AGENT_CONTAINER_WORKDIR: "/workspace",
    });
    expect(JSON.parse(String((nextConfig.env as Record<string, string>).PAPERCLIP_AGENT_CONTAINER_EXEC_ENV_JSON))).toMatchObject({
      CODEX_HOME: "/home/codex/.codex",
      PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND: "/paperclip/runtime/codex-managed/bin/codex",
      PAPERCLIP_RUNTIME_ROOT: "/workspace/.paperclip/runtime",
    });
  });
});

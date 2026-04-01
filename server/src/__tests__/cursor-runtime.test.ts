import { describe, expect, it, vi } from "vitest";
import {
  prepareCursorAdapterConfigForExecution,
  injectCursorContainerExecConfig,
} from "../services/cursor-runtime.js";

vi.mock("../services/cursor-managed-runtime.js", () => ({
  ensureManagedCursorRuntime: vi.fn(async () => ({
    schemaVersion: "v1",
    channel: "stable",
    source: "https://cursor.com/install",
    installRoot: "/tmp/paperclip/runtime-cache/cursor/stable/install-home",
    commandPath: "/tmp/paperclip/runtime-cache/cursor/stable/install-home/.local/bin/agent",
    version: "Cursor CLI 1.2.3",
    checkedAt: "2026-03-31T22:00:00.000Z",
    updatedAt: "2026-03-31T22:00:00.000Z",
    refreshIntervalMinutes: 360,
    refreshed: true,
  })),
}));

describe("prepareCursorAdapterConfigForExecution", () => {
  it("injects managed Cursor runtime env and command when command is not explicitly configured", async () => {
    const nextConfig = await prepareCursorAdapterConfigForExecution({
      cwd: "/tmp/paperclip/workspaces/cursor-1",
      config: {
        env: {},
      },
    });

    expect(nextConfig.command).toBe("/tmp/paperclip/runtime-cache/cursor/stable/install-home/.local/bin/agent");
    expect(nextConfig.env).toMatchObject({
      HOME: "/tmp/paperclip/workspaces/cursor-1/.paperclip/cursor-home",
      PAPERCLIP_CURSOR_MANAGED_RUNTIME_ROOT: "/tmp/paperclip/runtime-cache/cursor/stable/install-home",
      PAPERCLIP_CURSOR_MANAGED_RUNTIME_COMMAND:
        "/tmp/paperclip/runtime-cache/cursor/stable/install-home/.local/bin/agent",
      PAPERCLIP_CURSOR_MANAGED_RUNTIME_VERSION: "Cursor CLI 1.2.3",
      PAPERCLIP_CURSOR_MANAGED_RUNTIME_CHANNEL: "stable",
      PAPERCLIP_CURSOR_MANAGED_RUNTIME_SOURCE: "https://cursor.com/install",
      PAPERCLIP_CURSOR_MANAGED_RUNTIME_REFRESHED: "true",
    });
  });

  it("does not override an explicit command", async () => {
    const nextConfig = await prepareCursorAdapterConfigForExecution({
      cwd: "/tmp/paperclip/workspaces/cursor-1",
      config: {
        command: "/usr/local/bin/custom-agent",
        env: {
          HOME: "/tmp/custom-cursor-home",
        },
      },
    });

    expect(nextConfig.command).toBe("/usr/local/bin/custom-agent");
    expect(nextConfig.env).toMatchObject({ HOME: "/tmp/custom-cursor-home" });
    expect(nextConfig.env).not.toHaveProperty("PAPERCLIP_CURSOR_MANAGED_RUNTIME_COMMAND");
  });
});

describe("injectCursorContainerExecConfig", () => {
  it("switches the host command to the generic container-exec wrapper while preserving host-side env", () => {
    const nextConfig = injectCursorContainerExecConfig({
      config: {
        command: "/tmp/paperclip/runtime-cache/cursor/stable/install-home/.local/bin/agent",
        env: {
          HOME: "/tmp/paperclip/workspaces/run-1/.paperclip/cursor-home",
          PAPERCLIP_CURSOR_MANAGED_RUNTIME_COMMAND:
            "/tmp/paperclip/runtime-cache/cursor/stable/install-home/.local/bin/agent",
        },
      },
      containerId: "container-cursor-123",
      plan: {
        version: "v1",
        adapterType: "cursor",
        runner: {
          target: "agent_container",
          provider: "agent_container",
          workspaceStrategyType: "git_worktree",
          executionMode: "isolated_workspace",
          browserCapable: false,
          sandboxed: true,
          isolationBoundary: "container_process",
        },
        image: "paperclip/cursor-worker:dev",
        command: ["/paperclip/runtime/cursor-managed/.local/bin/agent"],
        workingDir: "/workspace",
        workspacePath: "/workspace",
        nativeHomePath: "/home/cursor",
        nativeSkillsPath: "/home/cursor/.cursor/skills",
        agentHomePath: "/home/cursor",
        sharedAuthSourcePath: null,
        runtimeBundleRoot: "/workspace/.paperclip/runtime",
        sharedContextPath: "/workspace/.paperclip/context/shared-context.json",
        provider: null,
        model: null,
        mounts: [],
        env: [
          { name: "HOME", value: "/home/cursor", secret: false, source: "worker_home" },
          {
            name: "PAPERCLIP_CURSOR_MANAGED_RUNTIME_COMMAND",
            value: "/paperclip/runtime/cursor-managed/.local/bin/agent",
            secret: false,
            source: "managed_runtime",
          },
          {
            name: "PAPERCLIP_CURSOR_MANAGED_RUNTIME_ROOT",
            value: "/paperclip/runtime/cursor-managed",
            secret: false,
            source: "managed_runtime",
          },
          { name: "PAPERCLIP_RUNTIME_ROOT", value: "/workspace/.paperclip/runtime", secret: false, source: "runtime_bundle" },
        ],
        runtimeService: {
          serviceName: "cursor-worker",
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
      HOME: "/tmp/paperclip/workspaces/run-1/.paperclip/cursor-home",
      PAPERCLIP_AGENT_CONTAINER_ID: "container-cursor-123",
      PAPERCLIP_AGENT_CONTAINER_COMMAND: "/paperclip/runtime/cursor-managed/.local/bin/agent",
      PAPERCLIP_AGENT_CONTAINER_WORKDIR: "/workspace",
      PAPERCLIP_AGENT_CONTAINER_WORKSPACE_PATH: "/workspace",
    });
    expect(
      JSON.parse(String((nextConfig.env as Record<string, string>).PAPERCLIP_AGENT_CONTAINER_EXEC_ENV_JSON)),
    ).toMatchObject({
      HOME: "/home/cursor",
      PAPERCLIP_CURSOR_MANAGED_RUNTIME_COMMAND: "/paperclip/runtime/cursor-managed/.local/bin/agent",
      PAPERCLIP_RUNTIME_ROOT: "/workspace/.paperclip/runtime",
    });
  });
});

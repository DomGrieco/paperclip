import { afterEach, describe, expect, it } from "vitest";
import {
  buildHermesContainerDockerArgs,
  injectHermesContainerLauncherService,
  isHermesContainerLauncherEnabled,
  stableHermesContainerRuntimeServiceId,
} from "../services/hermes-container-launcher.js";

afterEach(() => {
  delete process.env.PAPERCLIP_HERMES_CONTAINER_LAUNCHER_ENABLED;
});

describe("hermes-container-launcher", () => {
  it("enables via config or env override", () => {
    expect(isHermesContainerLauncherEnabled({ workspaceRuntime: { hermesContainerLauncher: { enabled: true } } })).toBe(true);
    process.env.PAPERCLIP_HERMES_CONTAINER_LAUNCHER_ENABLED = "false";
    expect(isHermesContainerLauncherEnabled({ workspaceRuntime: { hermesContainerLauncher: { enabled: true } } })).toBe(false);
  });

  it("injects a synthetic hermes_container runtime service when enabled", () => {
    const config = injectHermesContainerLauncherService({
      config: { workspaceRuntime: { hermesContainerLauncher: { enabled: true } } },
      plan: {
        version: "v1",
        runner: {
          target: "hermes_container",
          provider: "hermes_container",
          workspaceStrategyType: null,
          executionMode: null,
          browserCapable: false,
          sandboxed: true,
          isolationBoundary: "container_process",
        },
        image: "paperclip/hermes-worker:dev",
        command: ["hermes"],
        workingDir: "/workspace",
        workspacePath: "/workspace",
        agentHomePath: "/home/hermes/.hermes",
        sharedAuthSourcePath: "/paperclip/shared/hermes-home-source",
        runtimeBundleRoot: null,
        sharedContextPath: null,
        provider: "openai-codex",
        model: "gpt-5.3-codex",
        mounts: [],
        env: [],
        runtimeService: {
          serviceName: "hermes-worker",
          provider: "hermes_container",
          scopeType: "run",
          scopeId: "run-1",
          ownerAgentId: "agent-1",
        },
      },
    });
    const services = (config.workspaceRuntime as { services: Array<Record<string, unknown>> }).services;
    expect(services).toHaveLength(1);
    expect(services[0]?.provider).toBe("hermes_container");
  });

  it("builds docker args with mounts and env", () => {
    const serviceId = stableHermesContainerRuntimeServiceId({ runId: "run-1", serviceName: "hermes-worker", image: "paperclip-server:latest" });
    const args = buildHermesContainerDockerArgs({
      runId: "run-1",
      agentId: "agent-1",
      serviceId,
      image: "paperclip-server:latest",
      plan: {
        version: "v1",
        runner: {
          target: "hermes_container",
          provider: "hermes_container",
          workspaceStrategyType: null,
          executionMode: null,
          browserCapable: false,
          sandboxed: true,
          isolationBoundary: "container_process",
        },
        image: "paperclip-server:latest",
        command: ["hermes"],
        workingDir: "/workspace",
        workspacePath: "/workspace",
        agentHomePath: "/home/hermes/.hermes",
        sharedAuthSourcePath: null,
        runtimeBundleRoot: null,
        sharedContextPath: null,
        provider: null,
        model: null,
        mounts: [{ kind: "workspace", hostPath: "/tmp/workspace", containerPath: "/workspace", readOnly: false, purpose: "workspace" }],
        env: [{ name: "HERMES_HOME", value: "/home/hermes/.hermes", secret: false, source: "worker_home" }],
        runtimeService: { serviceName: "hermes-worker", provider: "hermes_container", scopeType: "run", scopeId: "run-1", ownerAgentId: "agent-1" },
      },
    });
    expect(args).toContain("paperclip-server:latest");
    expect(args).toContain("-v");
    expect(args).toContain("/tmp/workspace:/workspace");
    expect(args).toContain("-e");
    expect(args).toContain("HERMES_HOME=/home/hermes/.hermes");
  });
});

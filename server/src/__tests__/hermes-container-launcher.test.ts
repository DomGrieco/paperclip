import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDockerBindsFromPlan,
  buildHermesContainerDockerArgs,
  injectHermesContainerLauncherService,
  isHermesContainerLauncherEnabled,
  resolveHermesContainerSourceContainerName,
  resolveMountSourcePath,
  selectComposeServiceContainerName,
  stableHermesContainerRuntimeServiceId,
} from "../services/hermes-container-launcher.js";

afterEach(() => {
  delete process.env.PAPERCLIP_HERMES_CONTAINER_LAUNCHER_ENABLED;
  delete process.env.PAPERCLIP_HERMES_CONTAINER_SOURCE_CONTAINER;
  delete process.env.PAPERCLIP_HERMES_CONTAINER_API_URL;
  delete process.env.HOSTNAME;
  delete process.env.COMPOSE_PROJECT_NAME;
  delete process.env.PAPERCLIP_LISTEN_PORT;
  vi.restoreAllMocks();
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

  it("resolves a bind-mount source from a source container mount table", () => {
    expect(
      resolveMountSourcePath({
        containerPath: "/paperclip/instances/default/workspaces/agent-1",
        mounts: [
          { Source: "/var/lib/docker/volumes/paperclip-data/_data", Destination: "/paperclip" },
          { Source: "/Users/eru/.hermes", Destination: "/paperclip/shared/hermes-home-source" },
        ],
      }),
    ).toBe("/var/lib/docker/volumes/paperclip-data/_data/instances/default/workspaces/agent-1");
  });

  it("selects the running compose server-dev container name when HOSTNAME is unavailable", () => {
    expect(
      selectComposeServiceContainerName({
        project: "paperclip",
        serviceNames: ["server-dev", "server"],
        containers: [
          {
            Names: ["/paperclip-server-dev-1"],
            State: "running",
            Labels: {
              "com.docker.compose.project": "paperclip",
              "com.docker.compose.service": "server-dev",
              "com.docker.compose.oneoff": "False",
            },
          },
        ],
      }),
    ).toBe("paperclip-server-dev-1");
  });

  it("still prefers an explicit container source override", async () => {
    process.env.PAPERCLIP_HERMES_CONTAINER_SOURCE_CONTAINER = "explicit-paperclip-server";
    await expect(resolveHermesContainerSourceContainerName()).resolves.toBe("explicit-paperclip-server");
  });

  it("builds narrowed bind mounts from the launch plan instead of sharing the whole Paperclip volume", () => {
    const binds = buildDockerBindsFromPlan({
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
        sharedAuthSourcePath: "/paperclip/shared/hermes-home-source",
        runtimeBundleRoot: "/paperclip/runtime",
        sharedContextPath: "/workspace/.paperclip/context/shared-context.json",
        provider: null,
        model: null,
        mounts: [
          { kind: "workspace", hostPath: "/paperclip/instances/default/workspaces/agent-1", containerPath: "/workspace", readOnly: false, purpose: "workspace" },
          { kind: "agent_home", hostPath: "/paperclip/instances/default/companies/company-1/hermes-home", containerPath: "/home/hermes/.hermes", readOnly: false, purpose: "managed home" },
          { kind: "managed_runtime", hostPath: "/paperclip/instances/default/runtime-cache/hermes/channels/stable/installs/current", containerPath: "/paperclip/runtime/hermes-managed", readOnly: true, purpose: "managed runtime" },
          { kind: "shared_auth", hostPath: "/paperclip/shared/hermes-home-source", containerPath: "/paperclip/shared/hermes-home-source", readOnly: true, purpose: "bootstrap source" },
        ],
        env: [],
        runtimeService: { serviceName: "hermes-worker", provider: "hermes_container", scopeType: "run", scopeId: "run-1", ownerAgentId: "agent-1" },
      },
      sourceContainerMounts: [
        { Source: "/var/lib/docker/volumes/paperclip-data/_data", Destination: "/paperclip" },
        { Source: "/Users/eru/.hermes", Destination: "/paperclip/shared/hermes-home-source" },
      ],
    });

    expect(binds).toEqual([
      "/var/lib/docker/volumes/paperclip-data/_data/instances/default/workspaces/agent-1:/workspace",
      "/var/lib/docker/volumes/paperclip-data/_data/instances/default/companies/company-1/hermes-home:/home/hermes/.hermes",
      "/var/lib/docker/volumes/paperclip-data/_data/instances/default/runtime-cache/hermes/channels/stable/installs/current:/paperclip/runtime/hermes-managed:ro",
      "/var/lib/docker/volumes/paperclip-data/_data/instances/default/runtime-cache/hermes/channels/stable/installs/current:/paperclip/instances/default/runtime-cache/hermes/channels/stable/installs/current:ro",
      "/Users/eru/.hermes:/paperclip/shared/hermes-home-source:ro",
    ]);
  });
});

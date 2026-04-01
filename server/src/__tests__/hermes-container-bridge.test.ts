import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildHermesContainerBridgeRuntimeServices, isHermesContainerBridgeEnabled } from "../services/hermes-container-bridge.js";

const ORIGINAL_FLAG = process.env.PAPERCLIP_HERMES_CONTAINER_BRIDGE_ENABLED;

beforeEach(() => {
  delete process.env.PAPERCLIP_HERMES_CONTAINER_BRIDGE_ENABLED;
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.PAPERCLIP_HERMES_CONTAINER_BRIDGE_ENABLED;
  else process.env.PAPERCLIP_HERMES_CONTAINER_BRIDGE_ENABLED = ORIGINAL_FLAG;
});

describe("hermes-container-bridge", () => {
  it("enables the bridge when workspaceRuntime config requests it", () => {
    expect(
      isHermesContainerBridgeEnabled({
        config: { workspaceRuntime: { hermesContainerBridge: { enabled: true } } },
      }),
    ).toBe(true);
  });

  it("lets the environment flag override config", () => {
    process.env.PAPERCLIP_HERMES_CONTAINER_BRIDGE_ENABLED = "false";
    expect(
      isHermesContainerBridgeEnabled({
        config: { workspaceRuntime: { hermesContainerBridge: { enabled: true } } },
      }),
    ).toBe(false);
  });

  it("builds a hermes_container runtime-service report from the launch plan", () => {
    const reports = buildHermesContainerBridgeRuntimeServices({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes Worker",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      config: { workspaceRuntime: { hermesContainerBridge: { enabled: true } } },
      context: {
        paperclipHermesContainerPlan: {
          image: "paperclip/hermes-worker:dev",
          command: ["hermes"],
          workingDir: "/workspace/run-1",
          runner: { provider: "hermes_container" },
          runtimeService: {
            serviceName: "hermes-worker",
            provider: "hermes_container",
            scopeType: "run",
            scopeId: "run-1",
            ownerAgentId: "agent-1",
          },
        },
      },
    });

    expect(reports).toEqual([
      {
        id: expect.any(String),
        serviceName: "hermes-worker",
        provider: "hermes_container",
        providerRef: "launch-plan:paperclip/hermes-worker:dev",
        scopeType: "run",
        scopeId: "run-1",
        lifecycle: "ephemeral",
        status: "running",
        command: "hermes",
        cwd: "/workspace/run-1",
        ownerAgentId: "agent-1",
        stopPolicy: { type: "on_run_finish" },
        healthStatus: "healthy",
      },
    ]);
  });

  it("returns no reports when the bridge is disabled", () => {
    const reports = buildHermesContainerBridgeRuntimeServices({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes Worker",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      config: {},
      context: {
        paperclipHermesContainerPlan: {
          runner: { provider: "hermes_container" },
          runtimeService: { serviceName: "hermes-worker", scopeType: "run", scopeId: "run-1" },
        },
      },
    });

    expect(reports).toEqual([]);
  });
});

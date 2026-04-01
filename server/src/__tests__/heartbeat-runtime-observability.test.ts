// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildPaperclipRuntimeObservabilitySnapshot } from "../services/heartbeat.js";

const observability = buildPaperclipRuntimeObservabilitySnapshot({
  adapterType: "codex_local",
  companyId: "company-1",
  agentLastHeartbeatAt: new Date("2026-03-24T12:00:00.000Z"),
  runStartedAt: new Date("2026-03-24T12:00:00.000Z"),
  executionWorkspaceMode: "isolated_workspace",
  runtimeChannel: "stable",
  runtimeVersion: "1.2.3",
  managedSkillsDir: "/workspace/.paperclip/runtime/skills",
  managedSkillCount: 3,
  nativeHomeRoot: "/home/codex/.codex",
  nativeSkillsPath: "/home/codex/.codex/skills",
  runtimeService: {
    serviceName: "codex-worker",
    provider: "agent_container",
    providerRef: "container-123",
  },
});

describe("buildPaperclipRuntimeObservabilitySnapshot", () => {
  it("captures the minimum container runtime observability contract", () => {
    expect(observability.adapterContainerProfile).toEqual({
      adapterType: "codex_local",
      serviceName: "codex-worker",
      runnerProvider: "agent_container",
      browserCapable: false,
    });
    expect(observability.runtimeChannel).toBe("stable");
    expect(observability.runtimeVersion).toBe("1.2.3");
    expect(observability.executionWorkspaceMode).toBe("isolated_workspace");
    expect(observability.nativeHomeRoot).toBe("/home/codex/.codex");
    expect(observability.nativeSkillsProjection).toEqual({
      nativeSkillsPath: "/home/codex/.codex/skills",
      managedSkillsDir: "/workspace/.paperclip/runtime/skills",
      managedSkillCount: 3,
    });
    expect(observability.companySharedStateRoot).toContain("company-1");
    expect(observability.runtimeService).toEqual({
      serviceName: "codex-worker",
      provider: "agent_container",
      providerRef: "container-123",
    });
    expect(observability.heartbeatTimestampConsistency).toEqual({
      runStartedAt: "2026-03-24T12:00:00.000Z",
      agentLastHeartbeatAt: "2026-03-24T12:00:00.000Z",
      matchesRunStartedAt: true,
    });
  });
});

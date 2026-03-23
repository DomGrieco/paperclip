import { describe, expect, it } from "vitest";
import type { agents } from "@paperclipai/db";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
import {
  attachPaperclipSharedContextPacketToContext,
  attachRuntimeBundleToContext,
  formatRuntimeWorkspaceWarningLog,
  prioritizeProjectWorkspaceCandidatesForRun,
  parseSessionCompactionPolicy,
  resolveRuntimeBundleTargetForAgent,
  resolveRuntimeSessionParamsForWorkspace,
  shouldResetTaskSessionForWake,
  type ResolvedWorkspaceForRun,
} from "../services/heartbeat.ts";
import type { RuntimeBundle } from "@paperclipai/shared";

function buildResolvedWorkspace(overrides: Partial<ResolvedWorkspaceForRun> = {}): ResolvedWorkspaceForRun {
  return {
    cwd: "/tmp/project",
    source: "project_primary",
    projectId: "project-1",
    workspaceId: "workspace-1",
    repoUrl: null,
    repoRef: null,
    workspaceHints: [],
    warnings: [],
    ...overrides,
  };
}

function buildAgent(adapterType: string, runtimeConfig: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    companyId: "company-1",
    projectId: null,
    goalId: null,
    name: "Agent",
    role: "engineer",
    title: null,
    icon: null,
    status: "running",
    reportsTo: null,
    capabilities: null,
    adapterType,
    adapterConfig: {},
    runtimeConfig,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    permissions: {},
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as typeof agents.$inferSelect;
}

describe("resolveRuntimeSessionParamsForWorkspace", () => {
  it("migrates fallback workspace sessions to project workspace when project cwd becomes available", () => {
    const agentId = "agent-123";
    const fallbackCwd = resolveDefaultAgentWorkspaceDir(agentId);

    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId,
      previousSessionParams: {
        sessionId: "session-1",
        cwd: fallbackCwd,
        workspaceId: "workspace-1",
      },
      resolvedWorkspace: buildResolvedWorkspace({ cwd: "/tmp/new-project-cwd" }),
    });

    expect(result.sessionParams).toMatchObject({
      sessionId: "session-1",
      cwd: "/tmp/new-project-cwd",
      workspaceId: "workspace-1",
    });
    expect(result.warning).toContain("Attempting to resume session");
  });

  it("does not migrate when previous session cwd is not the fallback workspace", () => {
    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId: "agent-123",
      previousSessionParams: {
        sessionId: "session-1",
        cwd: "/tmp/some-other-cwd",
        workspaceId: "workspace-1",
      },
      resolvedWorkspace: buildResolvedWorkspace({ cwd: "/tmp/new-project-cwd" }),
    });

    expect(result.sessionParams).toEqual({
      sessionId: "session-1",
      cwd: "/tmp/some-other-cwd",
      workspaceId: "workspace-1",
    });
    expect(result.warning).toBeNull();
  });

  it("does not migrate when resolved workspace id differs from previous session workspace id", () => {
    const agentId = "agent-123";
    const fallbackCwd = resolveDefaultAgentWorkspaceDir(agentId);

    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId,
      previousSessionParams: {
        sessionId: "session-1",
        cwd: fallbackCwd,
        workspaceId: "workspace-1",
      },
      resolvedWorkspace: buildResolvedWorkspace({
        cwd: "/tmp/new-project-cwd",
        workspaceId: "workspace-2",
      }),
    });

    expect(result.sessionParams).toEqual({
      sessionId: "session-1",
      cwd: fallbackCwd,
      workspaceId: "workspace-1",
    });
    expect(result.warning).toBeNull();
  });
});

describe("shouldResetTaskSessionForWake", () => {
  it("resets session context on assignment wake", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "issue_assigned" })).toBe(true);
  });

  it("preserves session context on timer heartbeats", () => {
    expect(shouldResetTaskSessionForWake({ wakeSource: "timer" })).toBe(false);
  });

  it("preserves session context on manual on-demand invokes by default", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeSource: "on_demand",
        wakeTriggerDetail: "manual",
      }),
    ).toBe(false);
  });

  it("resets session context when a fresh session is explicitly requested", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeSource: "on_demand",
        wakeTriggerDetail: "manual",
        forceFreshSession: true,
      }),
    ).toBe(true);
  });

  it("does not reset session context on mention wake comment", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "issue_comment_mentioned",
        wakeCommentId: "comment-1",
      }),
    ).toBe(false);
  });

  it("does not reset session context when commentId is present", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "issue_commented",
        commentId: "comment-2",
      }),
    ).toBe(false);
  });

  it("does not reset for comment wakes", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "issue_commented" })).toBe(false);
  });

  it("does not reset when wake reason is missing", () => {
    expect(shouldResetTaskSessionForWake({})).toBe(false);
  });

  it("does not reset session context on callback on-demand invokes", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeSource: "on_demand",
        wakeTriggerDetail: "callback",
      }),
    ).toBe(false);
  });
});

describe("formatRuntimeWorkspaceWarningLog", () => {
  it("emits informational workspace warnings on stdout", () => {
    expect(formatRuntimeWorkspaceWarningLog("Using fallback workspace")).toEqual({
      stream: "stdout",
      chunk: "[paperclip] Using fallback workspace\n",
    });
  });
});

describe("prioritizeProjectWorkspaceCandidatesForRun", () => {
  it("moves the explicitly selected workspace to the front", () => {
    const rows = [
      { id: "workspace-1", cwd: "/tmp/one" },
      { id: "workspace-2", cwd: "/tmp/two" },
      { id: "workspace-3", cwd: "/tmp/three" },
    ];

    expect(
      prioritizeProjectWorkspaceCandidatesForRun(rows, "workspace-2").map((row) => row.id),
    ).toEqual(["workspace-2", "workspace-1", "workspace-3"]);
  });

  it("keeps the original order when no preferred workspace is selected", () => {
    const rows = [
      { id: "workspace-1" },
      { id: "workspace-2" },
    ];

    expect(
      prioritizeProjectWorkspaceCandidatesForRun(rows, null).map((row) => row.id),
    ).toEqual(["workspace-1", "workspace-2"]);
  });

  it("keeps the original order when the selected workspace is missing", () => {
    const rows = [
      { id: "workspace-1" },
      { id: "workspace-2" },
    ];

    expect(
      prioritizeProjectWorkspaceCandidatesForRun(rows, "workspace-9").map((row) => row.id),
    ).toEqual(["workspace-1", "workspace-2"]);
  });
});

describe("parseSessionCompactionPolicy", () => {
  it("disables Paperclip-managed rotation by default for codex and claude local", () => {
    expect(parseSessionCompactionPolicy(buildAgent("codex_local"))).toEqual({
      enabled: true,
      maxSessionRuns: 0,
      maxRawInputTokens: 0,
      maxSessionAgeHours: 0,
    });
    expect(parseSessionCompactionPolicy(buildAgent("claude_local"))).toEqual({
      enabled: true,
      maxSessionRuns: 0,
      maxRawInputTokens: 0,
      maxSessionAgeHours: 0,
    });
  });

  it("keeps conservative defaults for adapters without confirmed native compaction", () => {
    expect(parseSessionCompactionPolicy(buildAgent("cursor"))).toEqual({
      enabled: true,
      maxSessionRuns: 200,
      maxRawInputTokens: 2_000_000,
      maxSessionAgeHours: 72,
    });
    expect(parseSessionCompactionPolicy(buildAgent("opencode_local"))).toEqual({
      enabled: true,
      maxSessionRuns: 200,
      maxRawInputTokens: 2_000_000,
      maxSessionAgeHours: 72,
    });
  });

  it("lets explicit agent overrides win over adapter defaults", () => {
    expect(
      parseSessionCompactionPolicy(
        buildAgent("codex_local", {
          heartbeat: {
            sessionCompaction: {
              maxSessionRuns: 25,
              maxRawInputTokens: 500_000,
            },
          },
        }),
      ),
    ).toEqual({
      enabled: true,
      maxSessionRuns: 25,
      maxRawInputTokens: 500_000,
      maxSessionAgeHours: 0,
    });
  });
});

describe("resolveRuntimeBundleTargetForAgent", () => {
  it("maps the supported local coding adapters to runtime bundle targets", () => {
    expect(resolveRuntimeBundleTargetForAgent("codex_local")).toBe("codex");
    expect(resolveRuntimeBundleTargetForAgent("cursor")).toBe("cursor");
    expect(resolveRuntimeBundleTargetForAgent("opencode_local")).toBe("opencode");
    expect(resolveRuntimeBundleTargetForAgent("hermes_local")).toBe("hermes");
  });

  it("returns null for adapters without feature1 runtime bundle projections", () => {
    expect(resolveRuntimeBundleTargetForAgent("process")).toBeNull();
    expect(resolveRuntimeBundleTargetForAgent("claude_local")).toBeNull();
  });
});

describe("attachRuntimeBundleToContext", () => {
  it("delivers the resolved runtime bundle into the heartbeat context", () => {
    const bundle: RuntimeBundle = {
      runtime: "codex",
      company: { id: "company-1" },
      agent: { id: "agent-1", name: "Agent", adapterType: "codex_local" },
      project: { id: "project-1", name: "Project", executionWorkspacePolicy: null },
      issue: {
        id: "issue-1",
        identifier: "TST-1",
        title: "Implement runtime bundle",
        status: "in_progress",
        priority: "high",
      },
      run: {
        id: "run-1",
        runType: "worker",
        rootRunId: "run-0",
        parentRunId: "run-0",
        graphDepth: 1,
        repairAttempt: 0,
        verificationVerdict: null,
      },
      policy: {
        tddMode: "required",
        evidencePolicy: "code_ci_evaluator_summary",
        evidencePolicySource: "company_default",
        maxRepairAttempts: 3,
        requiresHumanArtifacts: false,
      },
      verification: {
        required: true,
        requiresEvaluatorSummary: true,
        requiresArtifacts: false,
        latestVerificationRunId: null,
        reviewReadyAt: null,
        runner: {
          target: "local_host",
          provider: "local_process",
          workspaceStrategyType: null,
          executionMode: null,
          browserCapable: false,
          sandboxed: false,
          isolationBoundary: "host_process",
        },
      },
      memory: {
        snippets: [],
      },
      projection: {
        runtime: "codex",
        contextKey: "paperclipRuntimeBundle",
        envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON",
        materializationRoot: ".paperclip/runtime",
      },
    };

    expect(attachRuntimeBundleToContext({ issueId: "issue-1" }, bundle)).toMatchObject({
      issueId: "issue-1",
      paperclipRuntimeBundle: bundle,
      paperclipRuntimeProjection: bundle.projection,
      paperclipPolicy: bundle.policy,
      paperclipMemoryRecall: bundle.memory,
    });
  });

  it("removes runtime bundle fields when no bundle is available", () => {
    const context = attachRuntimeBundleToContext(
      {
        issueId: "issue-1",
        paperclipRuntimeBundle: { stale: true },
        paperclipRuntimeProjection: { stale: true },
        paperclipPolicy: { stale: true },
        paperclipMemoryRecall: { stale: true },
        paperclipSharedContextPacket: { stale: true },
      },
      null,
    );

    expect(context).toEqual({
      issueId: "issue-1",
    });
  });
});

describe("attachPaperclipSharedContextPacketToContext", () => {
  it("builds a governed shared-context packet from the runtime bundle", () => {
    const bundle: RuntimeBundle = {
      runtime: "hermes",
      company: { id: "company-1" },
      agent: { id: "agent-1", name: "Hermes", adapterType: "hermes_local" },
      project: { id: "project-1", name: "Project", executionWorkspacePolicy: null },
      issue: {
        id: "issue-1",
        identifier: "TST-1",
        title: "Ship shared context packet",
        status: "in_progress",
        priority: "high",
      },
      run: {
        id: "run-1",
        runType: "worker",
        rootRunId: "run-0",
        parentRunId: "run-0",
        graphDepth: 1,
        repairAttempt: 0,
        verificationVerdict: null,
      },
      policy: {
        tddMode: "required",
        evidencePolicy: "code_ci_evaluator_summary",
        evidencePolicySource: "company_default",
        maxRepairAttempts: 3,
        requiresHumanArtifacts: false,
      },
      verification: {
        required: true,
        requiresEvaluatorSummary: true,
        requiresArtifacts: false,
        latestVerificationRunId: null,
        reviewReadyAt: null,
        runner: {
          target: "hermes_container",
          provider: "hermes_container",
          workspaceStrategyType: null,
          executionMode: null,
          browserCapable: false,
          sandboxed: true,
          isolationBoundary: "container_process",
        },
      },
      memory: {
        snippets: [],
      },
      projection: {
        runtime: "hermes",
        contextKey: "paperclipRuntimeBundle",
        envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON",
        materializationRoot: ".paperclip/runtime",
      },
    };

    expect(
      attachPaperclipSharedContextPacketToContext({}, {
        runtimeBundle: bundle,
        workspaceCwd: "/workspace/run-1",
        runtimeBundleRoot: "/workspace/run-1/.paperclip/runtime",
        runtimeInstructionsPath: "/workspace/run-1/.paperclip/runtime/instructions.md",
        sharedContextPath: "/workspace/run-1/.paperclip/context/shared-context.json",
      }),
    ).toMatchObject({
      paperclipSharedContextPacket: {
        version: "v1",
        scope: {
          companyId: "company-1",
          projectId: "project-1",
          issueId: "issue-1",
          runId: "run-1",
          agentId: "agent-1",
        },
        provenance: {
          source: "runtime_bundle",
          workspaceCwd: "/workspace/run-1",
          runtimeBundleRoot: "/workspace/run-1/.paperclip/runtime",
          runtimeInstructionsPath: "/workspace/run-1/.paperclip/runtime/instructions.md",
          sharedContextPath: "/workspace/run-1/.paperclip/context/shared-context.json",
        },
      },
    });
  });

  it("clears the packet when the runtime bundle or workspace is missing", () => {
    const context = attachPaperclipSharedContextPacketToContext(
      {
        paperclipSharedContextPacket: { stale: true },
      },
      {
        runtimeBundle: null,
        workspaceCwd: "/workspace/run-1",
        runtimeBundleRoot: null,
        runtimeInstructionsPath: null,
        sharedContextPath: null,
      },
    );

    expect(context).toEqual({});
  });
});

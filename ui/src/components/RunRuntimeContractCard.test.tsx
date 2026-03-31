// @vitest-environment node

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HeartbeatRun } from "@paperclipai/shared";
import { RunRuntimeContractCard } from "./RunRuntimeContractCard";

const run: HeartbeatRun = {
  id: "run-1",
  companyId: "company-1",
  agentId: "agent-1",
  invocationSource: "on_demand",
  triggerDetail: "manual",
  status: "running",
  startedAt: new Date("2026-03-24T12:00:00.000Z"),
  finishedAt: null,
  error: null,
  wakeupRequestId: null,
  exitCode: null,
  signal: null,
  usageJson: null,
  resultJson: null,
  sessionIdBefore: null,
  sessionIdAfter: null,
  logStore: null,
  logRef: null,
  logBytes: null,
  logSha256: null,
  logCompressed: false,
  stdoutExcerpt: null,
  stderrExcerpt: null,
  errorCode: null,
  externalRunId: null,
  runType: "worker",
  rootRunId: "run-1",
  parentRunId: null,
  graphDepth: 0,
  verificationVerdict: null,
  repairAttempt: 0,
  policySnapshotJson: null,
  runnerSnapshotJson: {
    target: "hermes_container",
    provider: "hermes_container",
    workspaceStrategyType: "git_worktree",
    executionMode: "isolated_workspace",
    browserCapable: false,
    sandboxed: true,
    isolationBoundary: "container_process",
  },
  artifactBundleJson: null,
  contextSnapshot: {
    paperclipHermesContainerPlan: {
      version: "v1",
      runner: {
        target: "hermes_container",
        provider: "hermes_container",
        workspaceStrategyType: "git_worktree",
        executionMode: "isolated_workspace",
        browserCapable: false,
        sandboxed: true,
        isolationBoundary: "container_process",
      },
      image: "paperclip-server:latest",
      command: ["hermes", "chat"],
      workingDir: "/workspace",
      workspacePath: "/workspace",
      agentHomePath: "/home/hermes/.hermes",
      sharedAuthSourcePath: "/paperclip/shared/hermes-home-source",
      runtimeBundleRoot: "/workspace/.paperclip/runtime",
      sharedContextPath: "/workspace/.paperclip/context/shared-context.json",
      provider: "openai-codex",
      model: "gpt-5.3-codex",
      mounts: [
        {
          kind: "workspace",
          hostPath: "/paperclip/instances/default/workspaces/agent-1",
          containerPath: "/workspace",
          readOnly: false,
          purpose: "workspace",
        },
      ],
      env: [
        {
          name: "HERMES_HOME",
          value: "/home/hermes/.hermes",
          secret: false,
          source: "worker_home",
        },
      ],
      runtimeService: {
        serviceName: "hermes-worker",
        provider: "hermes_container",
        scopeType: "run",
        scopeId: "run-1",
        ownerAgentId: "agent-1",
      },
    },
    paperclipSharedContextPacket: {
      version: "v1",
      scope: {
        companyId: "company-1",
        projectId: "project-1",
        issueId: "issue-1",
        runId: "run-1",
        agentId: "agent-1",
      },
      policy: {
        tddMode: "required",
        evidencePolicy: "code_ci_evaluator_summary_artifacts",
        evidencePolicySource: "issue_override",
        maxRepairAttempts: 3,
        requiresHumanArtifacts: true,
      },
      runner: {
        target: "hermes_container",
        provider: "hermes_container",
        workspaceStrategyType: "git_worktree",
        executionMode: "isolated_workspace",
        browserCapable: false,
        sandboxed: true,
        isolationBoundary: "container_process",
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
      memory: {
        snippets: [
          {
            scope: "issue",
            source: "issue.description",
            content: "Validate the Hermes container launch contract.",
          },
        ],
      },
      managedSkills: {
        skillsDir: "/workspace/.paperclip/runtime/skills",
        entries: [
          {
            name: "managed-skill",
            sourceType: "company",
            sourceLabel: "company",
            managedSkillId: "skill-1",
            scopeId: "company-1",
          },
        ],
      },
      provenance: {
        source: "runtime_bundle",
        workspaceCwd: "/workspace",
        runtimeBundleRoot: "/workspace/.paperclip/runtime",
        runtimeInstructionsPath: "/workspace/.paperclip/runtime/instructions.md",
        sharedContextPath: "/workspace/.paperclip/context/shared-context.json",
      },
    },
    paperclipRuntimeBundle: {
      runtime: "hermes",
      company: { id: "company-1" },
      agent: { id: "agent-1", name: "Hermes Worker", adapterType: "hermes_local" },
      project: { id: "project-1", name: "Project Hermes", executionWorkspacePolicy: null },
      issue: {
        id: "issue-1",
        identifier: "PAP-321",
        title: "Harden swarm worker workspace visibility",
        status: "in_progress",
        priority: "high",
      },
      run: {
        id: "run-1",
        runType: "worker",
        rootRunId: "run-1",
        parentRunId: null,
        graphDepth: 0,
        repairAttempt: 0,
        verificationVerdict: null,
      },
      policy: {
        tddMode: "required",
        evidencePolicy: "code_ci_evaluator_summary_artifacts",
        evidencePolicySource: "issue_override",
        maxRepairAttempts: 3,
        requiresHumanArtifacts: true,
      },
      runner: {
        target: "hermes_container",
        provider: "hermes_container",
        workspaceStrategyType: "git_worktree",
        executionMode: "isolated_workspace",
        browserCapable: false,
        sandboxed: true,
        isolationBoundary: "container_process",
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
      swarm: {
        plan: null,
        currentSubtask: {
          id: "subtask-1",
          kind: "implementation",
          title: "Patch activity timeline rendering",
          goal: "Render swarm workspace ownership data for operators.",
          taskKey: "activity-timeline",
          allowedPaths: ["ui/src/components/RunRuntimeContractCard.tsx"],
          forbiddenPaths: ["server/src/services/heartbeat.ts"],
          ownershipMode: "exclusive",
          expectedArtifacts: [{ kind: "patch", required: true }],
          acceptanceChecks: ["Run detail shows swarm workspace warnings"],
          recommendedModelTier: "balanced",
        },
        workspaceGuard: {
          enforcedMode: "isolated_workspace",
          warnings: ["Swarm subtask subtask-1 forced into an isolated workspace to avoid parallel edit collisions."],
          errors: [],
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
    },
    paperclipRuntimeServices: [
      {
        id: "service-1",
        serviceName: "hermes-worker",
        status: "running",
        provider: "hermes_container",
        providerRef: "container-1234567890abcdef",
        cwd: "/workspace",
        url: null,
        reused: false,
      },
    ],
  },
  createdAt: new Date("2026-03-24T12:00:00.000Z"),
  updatedAt: new Date("2026-03-24T12:00:00.000Z"),
};

describe("RunRuntimeContractCard", () => {
  it("renders hermes container launch-plan, shared-context, swarm contract, and runtime-service details", () => {
    const html = renderToStaticMarkup(<RunRuntimeContractCard run={run} />);

    expect(html).toContain("Runtime Contract");
    expect(html).toContain("Hermes Container");
    expect(html).toContain("Hermes Container Plan");
    expect(html).toContain("paperclip-server:latest");
    expect(html).toContain("gpt-5.3-codex");
    expect(html).toContain("Shared Context Packet");
    expect(html).toContain("issue-1");
    expect(html).toContain("Memory Snippets");
    expect(html).toContain("Swarm Workspace Contract");
    expect(html).toContain("Patch activity timeline rendering");
    expect(html).toContain("activity-timeline");
    expect(html).toContain("ui/src/components/RunRuntimeContractCard.tsx");
    expect(html).toContain("Swarm subtask subtask-1 forced into an isolated workspace");
    expect(html).toContain("Runtime Services");
    expect(html).toContain("container-12345678");
  });

  it("returns no markup when the run has no surfaced runtime contract", () => {
    const emptyHtml = renderToStaticMarkup(
      <RunRuntimeContractCard
        run={{
          ...run,
          runnerSnapshotJson: null,
          contextSnapshot: null,
        }}
      />,
    );

    expect(emptyHtml).toBe("");
  });
});

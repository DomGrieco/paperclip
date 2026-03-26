// @vitest-environment node

import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IssueEvidenceBundle, IssueOrchestrationSummary } from "@paperclipai/shared";
import { IssueEvidenceBundleCard, IssueRunGraphCard } from "./IssueRunGraphCard";
import { vi } from "vitest";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: { issuePrefix: "TST" },
  }),
}));

const orchestration: IssueOrchestrationSummary = {
  rootRunId: "run-plan",
  lastVerificationRunId: "run-verify",
  reviewReadyAt: new Date("2026-03-22T12:00:00.000Z"),
  evidencePolicy: "code_ci_evaluator_summary",
  evidencePolicySource: "company_default",
  evidenceBundle: null,
  issueSharedContextPublications: [
    {
      id: "pub-1",
      companyId: "company-1",
      projectId: null,
      issueId: "issue-1",
      sourceAgentId: "agent-shared-1234",
      createdByRunId: "run-shared-5678",
      title: "API auth gotcha",
      summary: "Use Paperclip helper auth headers instead of ad hoc curl tokens.",
      body: "The runtime bundle already injects the helper auth surface for local fleet runs.",
      tags: ["hermes", "auth"],
      visibility: "issue",
      audienceAgentIds: [],
      status: "published",
      freshness: "recent",
      freshnessAt: "2026-03-24T19:30:00.000Z",
      confidence: 0.91,
      rank: 5,
      provenance: { source: "runtime_bundle" },
      createdAt: new Date("2026-03-24T19:20:00.000Z"),
      updatedAt: new Date("2026-03-24T19:30:00.000Z"),
    },
  ],
  nodes: [
    {
      id: "run-plan",
      runType: "planner",
      status: "succeeded",
      parentRunId: null,
      rootRunId: "run-plan",
      graphDepth: 0,
      repairAttempt: 0,
      verificationVerdict: null,
      runnerSnapshotJson: {
        target: "local_host",
        provider: "local_process",
        workspaceStrategyType: "git_worktree",
        executionMode: "isolated_workspace",
        browserCapable: false,
        sandboxed: false,
        isolationBoundary: "host_process",
      },
    },
    {
      id: "run-work",
      runType: "worker",
      status: "failed",
      parentRunId: "run-plan",
      rootRunId: "run-plan",
      graphDepth: 1,
      repairAttempt: 1,
      verificationVerdict: null,
    },
    {
      id: "run-verify",
      runType: "verification",
      status: "succeeded",
      parentRunId: "run-plan",
      rootRunId: "run-plan",
      graphDepth: 1,
      repairAttempt: 0,
      verificationVerdict: "pass",
      runnerSnapshotJson: {
        target: "cloud_sandbox",
        provider: "cloud_sandbox",
        workspaceStrategyType: "cloud_sandbox",
        executionMode: "isolated_workspace",
        browserCapable: true,
        sandboxed: true,
        isolationBoundary: "cloud_sandbox",
      },
    },
  ],
};

const evidence: IssueEvidenceBundle = {
  policy: "code_ci_evaluator_summary",
  policySource: "company_default",
  reviewReadyAt: new Date("2026-03-22T12:00:00.000Z"),
  lastVerificationRunId: "run-verify",
  bundle: {
    evaluatorSummary: "CI passed and review notes attached.",
    verdict: "pass",
    artifacts: [
      {
        artifactId: "artifact-1",
        artifactKind: "screenshot",
        role: "review",
        label: "before-fix",
        metadata: { path: "artifacts/screenshot.png" },
      },
      {
        artifactId: "artifact-2",
        artifactKind: "log_bundle",
        role: "ci",
        label: "logs",
        metadata: { path: "artifacts/logs.zip" },
      },
    ],
  },
};

describe("IssueRunGraphCard", () => {
  it("renders run graph nodes, readiness, and repair metadata", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/TST/issues/issue-1"]}>
        <Routes>
          <Route
            path="/:companyPrefix/issues/:issueId"
            element={
              <IssueRunGraphCard
                orchestration={orchestration}
                runLinks={new Map([
                  ["run-plan", "/agents/agent-plan/runs/run-plan"],
                  ["run-work", "/agents/agent-work/runs/run-work"],
                  ["run-verify", "/agents/agent-verify/runs/run-verify"],
                ])}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("Orchestration");
    expect(html).toContain("Review Ready");
    expect(html).toContain("Planner");
    expect(html).toContain("Worker");
    expect(html).toContain("Verification");
    expect(html).toContain("Repair 1");
    expect(html).toContain("Local Host");
    expect(html).toContain("Cloud Sandbox");
    expect(html).toContain("Browser Capable");
    expect(html).toContain("/TST/agents/agent-plan/runs/run-plan");
    expect(html).toContain("/TST/agents/agent-verify/runs/run-verify");
    expect(html).toContain("Shared Context");
    expect(html).toContain("API auth gotcha");
    expect(html).toContain("Issue Scope");
    expect(html).toContain("#hermes");
  });

  it("renders evaluator summary and artifact evidence details", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/TST/issues/issue-1"]}>
        <Routes>
          <Route
            path="/:companyPrefix/issues/:issueId"
            element={
              <IssueEvidenceBundleCard
                evidenceBundle={evidence}
                verificationRunHref="/agents/agent-verify/runs/run-verify"
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("Review Bundle");
    expect(html).toContain("CI passed and review notes attached.");
    expect(html).toContain("artifacts/screenshot.png");
    expect(html).toContain("artifacts/logs.zip");
    expect(html).toContain("/TST/agents/agent-verify/runs/run-verify");
  });
});

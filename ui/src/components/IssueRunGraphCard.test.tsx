// @vitest-environment node

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IssueEvidenceBundle, IssueOrchestrationSummary } from "@paperclipai/shared";
import { IssueEvidenceBundleCard, IssueRunGraphCard } from "./IssueRunGraphCard";

const orchestration: IssueOrchestrationSummary = {
  rootRunId: "run-plan",
  lastVerificationRunId: "run-verify",
  reviewReadyAt: new Date("2026-03-22T12:00:00.000Z"),
  evidencePolicy: "code_ci_evaluator_summary",
  evidencePolicySource: "company_default",
  evidenceBundle: null,
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
      <IssueRunGraphCard
        orchestration={orchestration}
        runLinks={new Map([
          ["run-plan", "/agents/agent-plan/runs/run-plan"],
          ["run-work", "/agents/agent-work/runs/run-work"],
          ["run-verify", "/agents/agent-verify/runs/run-verify"],
        ])}
      />,
    );

    expect(html).toContain("Orchestration");
    expect(html).toContain("Review Ready");
    expect(html).toContain("Planner");
    expect(html).toContain("Worker");
    expect(html).toContain("Verification");
    expect(html).toContain("Repair 1");
    expect(html).toContain("/agents/agent-verify/runs/run-verify");
  });

  it("renders evaluator summary and artifact evidence details", () => {
    const html = renderToStaticMarkup(
      <IssueEvidenceBundleCard
        evidenceBundle={evidence}
        verificationRunHref="/agents/agent-verify/runs/run-verify"
      />,
    );

    expect(html).toContain("Review Bundle");
    expect(html).toContain("CI passed and review notes attached.");
    expect(html).toContain("artifacts/screenshot.png");
    expect(html).toContain("artifacts/logs.zip");
    expect(html).toContain("/agents/agent-verify/runs/run-verify");
  });
});

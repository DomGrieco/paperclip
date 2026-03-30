import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AdapterArtifactReport } from "@paperclipai/adapter-utils";
import type { Db } from "@paperclipai/db";
import { heartbeatRunArtifacts, heartbeatRuns, issues } from "@paperclipai/db";
import type {
  EvidencePolicy,
  EvidencePolicySource,
  HeartbeatRunArtifact,
  IssueEvidenceBundle,
  OrchestrationArtifactBundle,
  OrchestrationArtifactBundleItem,
  OrchestrationPolicySnapshot,
  StructuredChildOutput,
  SwarmArtifactKind,
  SwarmPlannerSynthesis,
  SwarmReviewerDecision,
  SwarmReviewerDecisionRecord,
  SwarmSubtask,
  VerificationVerdict,
} from "@paperclipai/shared";
import { notFound } from "../errors.js";

const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

type IssueEvidenceRow = Pick<
  typeof issues.$inferSelect,
  | "id"
  | "companyId"
  | "evidencePolicy"
  | "evidencePolicySource"
  | "reviewReadyAt"
  | "lastVerificationRunId"
>;

type VerificationRunRow = typeof heartbeatRuns.$inferSelect;

function readIssueId(value: Record<string, unknown> | null | undefined) {
  const issueId = value?.issueId;
  return typeof issueId === "string" && issueId.trim().length > 0 ? issueId.trim() : null;
}

function readEvaluatorSummary(value: Record<string, unknown> | null | undefined) {
  const summary = value?.evaluatorSummary;
  return typeof summary === "string" && summary.trim().length > 0 ? summary.trim() : null;
}

function asEvidencePolicy(value: string): EvidencePolicy {
  return value as EvidencePolicy;
}

function asEvidencePolicySource(value: string): EvidencePolicySource {
  return value as EvidencePolicySource;
}

function readMaxRepairAttempts(value: Record<string, unknown> | null | undefined) {
  const raw = value?.maxRepairAttempts;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_MAX_REPAIR_ATTEMPTS;
  return Math.max(0, Math.trunc(raw));
}

function reviewReadySatisfied(policy: EvidencePolicy, bundle: OrchestrationArtifactBundle) {
  const hasEvaluatorSummary = typeof bundle.evaluatorSummary === "string" && bundle.evaluatorSummary.trim().length > 0;
  const hasArtifacts = (bundle.artifacts?.length ?? 0) > 0;

  if (policy === "code_ci_evaluator_summary") return hasEvaluatorSummary;
  if (policy === "code_ci_evaluator_summary_artifacts") return hasEvaluatorSummary && hasArtifacts;
  return true;
}

function toArtifactItem(artifact: HeartbeatRunArtifact): OrchestrationArtifactBundleItem {
  return {
    artifactId: artifact.id,
    artifactKind: artifact.artifactKind,
    role: artifact.role,
    label: artifact.label,
    ...(artifact.assetId ? { assetId: artifact.assetId } : {}),
    ...(artifact.documentId ? { documentId: artifact.documentId } : {}),
    ...(artifact.issueWorkProductId ? { issueWorkProductId: artifact.issueWorkProductId } : {}),
    ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
  };
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function readStructuredChildOutput(value: Record<string, unknown> | null | undefined): StructuredChildOutput | null {
  if (!value) return null;
  const orchestration = parseRecord(value.orchestration);
  const candidate = parseRecord(value.childOutput) ?? parseRecord(orchestration?.childOutput) ?? parseRecord(value.output);
  if (!candidate) return null;

  const summary = typeof candidate.summary === "string" && candidate.summary.trim().length > 0
    ? candidate.summary.trim()
    : null;
  if (!summary) return null;

  const artifactClaims = Array.isArray(candidate.artifactClaims)
    ? candidate.artifactClaims
        .map((entry) => {
          const claim = parseRecord(entry);
          const kind = typeof claim?.kind === "string" && claim.kind.trim().length > 0 ? claim.kind.trim() : null;
          if (!kind) return null;
          return {
            kind,
            ...(typeof claim?.label === "string" && claim.label.trim().length > 0 ? { label: claim.label.trim() } : {}),
            ...(typeof claim?.detail === "string" && claim.detail.trim().length > 0 ? { detail: claim.detail.trim() } : {}),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];

  const status = candidate.status === "completed" || candidate.status === "blocked" ? candidate.status : null;
  return {
    summary,
    ...(status ? { status } : {}),
    ...(parseStringArray(candidate.notes).length > 0 ? { notes: parseStringArray(candidate.notes) } : {}),
    ...(artifactClaims.length > 0 ? { artifactClaims } : {}),
  };
}

function readSwarmSubtask(value: Record<string, unknown> | null | undefined): SwarmSubtask | null {
  const subtask = parseRecord(value?.swarmSubtask);
  if (!subtask) return null;
  return subtask as unknown as SwarmSubtask;
}

function readRequiredArtifactKinds(subtask: SwarmSubtask | null): SwarmArtifactKind[] {
  if (!subtask || !Array.isArray(subtask.expectedArtifacts)) return [];
  return subtask.expectedArtifacts
    .filter((artifact) => artifact.required)
    .map((artifact) => artifact.kind)
    .filter((kind): kind is SwarmArtifactKind => typeof kind === "string" && kind.trim().length > 0);
}

function buildArtifactReportsFromStructuredChildOutput(input: {
  issueId: string | null;
  resultJson: Record<string, unknown> | null | undefined;
  role?: string | null;
}): AdapterArtifactReport[] {
  const childOutput = readStructuredChildOutput(input.resultJson);
  if (!childOutput?.artifactClaims?.length) return [];

  return childOutput.artifactClaims.map((claim) => ({
    issueId: input.issueId,
    artifactKind: claim.kind,
    role: input.role ?? null,
    label: claim.label ?? null,
    metadata: {
      source: "structured_child_output_claim",
      ...(claim.detail ? { detail: claim.detail } : {}),
      summary: childOutput.summary,
      ...(childOutput.status ? { status: childOutput.status } : {}),
      ...(childOutput.notes?.length ? { notes: childOutput.notes } : {}),
    },
  }));
}

function summarizeSynthesis(decisions: SwarmReviewerDecisionRecord[]): string {
  const accepted = decisions.filter((decision) => decision.decision === "accept");
  const repair = decisions.filter((decision) => decision.decision === "request_repair");
  const rejected = decisions.filter((decision) => decision.decision === "reject");
  const acceptedLabels = accepted
    .map((decision) => decision.taskKey ?? decision.subtaskId ?? decision.workerRunId)
    .slice(0, 3)
    .join(", ");
  const acceptedText = accepted.length > 0 ? ` Accepted: ${acceptedLabels}.` : "";
  return `Accepted ${accepted.length} child outputs, requested repair for ${repair.length}, rejected ${rejected.length}.${acceptedText}`;
}

export function issueRunEvidenceService(db: Db) {
  async function getIssueEvidenceRow(issueId: string): Promise<IssueEvidenceRow> {
    const issue = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        evidencePolicy: issues.evidencePolicy,
        evidencePolicySource: issues.evidencePolicySource,
        reviewReadyAt: issues.reviewReadyAt,
        lastVerificationRunId: issues.lastVerificationRunId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);

    if (!issue) throw notFound("Issue not found");
    return issue;
  }

  async function getVerificationRunById(runId: string) {
    return db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function getLatestVerificationRun(issue: IssueEvidenceRow): Promise<VerificationRunRow | null> {
    if (issue.lastVerificationRunId) {
      const persisted = await getVerificationRunById(issue.lastVerificationRunId);
      if (
        persisted &&
        persisted.companyId === issue.companyId &&
        persisted.runType === "verification" &&
        readIssueId(persisted.contextSnapshot) === issue.id
      ) {
        return persisted;
      }
    }

    return db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, issue.companyId),
          eq(heartbeatRuns.runType, "verification"),
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function listRunArtifacts(runId: string): Promise<HeartbeatRunArtifact[]> {
    return db
      .select()
      .from(heartbeatRunArtifacts)
      .where(eq(heartbeatRunArtifacts.runId, runId))
      .orderBy(
        asc(heartbeatRunArtifacts.createdAt),
        asc(heartbeatRunArtifacts.label),
        asc(heartbeatRunArtifacts.id),
      );
  }

  async function buildArtifactBundle(run: VerificationRunRow): Promise<OrchestrationArtifactBundle> {
    const artifacts = await listRunArtifacts(run.id);
    const evaluatorSummary = readEvaluatorSummary(run.artifactBundleJson) ?? readEvaluatorSummary(run.resultJson);
    const bundle: OrchestrationArtifactBundle = {
      evaluatorSummary,
      verdict: (run.verificationVerdict ?? null) as VerificationVerdict | null,
      artifacts: artifacts.map(toArtifactItem),
    };

    if (!bundle.evaluatorSummary && (!bundle.artifacts || bundle.artifacts.length === 0) && !bundle.verdict) {
      return {};
    }

    return bundle;
  }

  async function getIssueEvidenceBundle(issueId: string): Promise<IssueEvidenceBundle> {
    const issue = await getIssueEvidenceRow(issueId);
    const verification = await getLatestVerificationRun(issue);
    const bundle = verification ? await buildArtifactBundle(verification) : null;
    const policy = asEvidencePolicy(issue.evidencePolicy);
    const reviewReadyAt =
      verification?.verificationVerdict === "pass" && bundle && reviewReadySatisfied(policy, bundle)
        ? verification.finishedAt ?? issue.reviewReadyAt ?? null
        : null;

    return {
      policy,
      policySource: asEvidencePolicySource(issue.evidencePolicySource),
      reviewReadyAt,
      lastVerificationRunId: verification?.id ?? issue.lastVerificationRunId ?? null,
      bundle: bundle && (bundle.evaluatorSummary || bundle.verdict || (bundle.artifacts?.length ?? 0) > 0) ? bundle : null,
    };
  }

  async function persistReportedRunArtifacts(input: {
    companyId: string;
    runId: string;
    issueId: string | null;
    artifacts: AdapterArtifactReport[];
  }) {
    if (input.artifacts.length === 0) return [];

    const existing = await listRunArtifacts(input.runId);
    const existingKeys = new Set(
      existing.map((artifact) => `${artifact.artifactKind}::${artifact.label ?? ""}::${artifact.role ?? ""}`),
    );
    const artifactsToInsert = input.artifacts.filter((artifact) => {
      const key = `${artifact.artifactKind}::${artifact.label ?? ""}::${artifact.role ?? ""}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    if (artifactsToInsert.length === 0) return [];

    return db
      .insert(heartbeatRunArtifacts)
      .values(
        artifactsToInsert.map((artifact) => ({
          companyId: input.companyId,
          runId: input.runId,
          issueId: artifact.issueId ?? input.issueId,
          artifactKind: artifact.artifactKind,
          role: artifact.role ?? null,
          label: artifact.label ?? null,
          assetId: artifact.assetId ?? null,
          documentId: artifact.documentId ?? null,
          issueWorkProductId: artifact.issueWorkProductId ?? null,
          metadata: artifact.metadata ?? null,
        })),
      )
      .returning();
  }

  async function persistStructuredChildOutputArtifacts(input: {
    companyId: string;
    runId: string;
    issueId: string | null;
    resultJson: Record<string, unknown> | null | undefined;
    role?: string | null;
  }) {
    const artifacts = buildArtifactReportsFromStructuredChildOutput({
      issueId: input.issueId,
      resultJson: input.resultJson,
      role: input.role,
    });
    if (artifacts.length === 0) return [];
    return persistReportedRunArtifacts({
      companyId: input.companyId,
      runId: input.runId,
      issueId: input.issueId,
      artifacts,
    });
  }

  async function syncVerificationOutcome(runId: string) {
    const verification = await getVerificationRunById(runId);
    if (!verification || verification.runType !== "verification") return null;

    const issueId = readIssueId(verification.contextSnapshot);
    if (!issueId) return null;

    const issue = await getIssueEvidenceRow(issueId);
    if (issue.companyId !== verification.companyId) return null;

    const maxRepairAttempts = readMaxRepairAttempts(verification.policySnapshotJson);
    const bundle = await buildArtifactBundle(verification);
    const issuePolicy = asEvidencePolicy(issue.evidencePolicy);
    const policySnapshot: OrchestrationPolicySnapshot = {
      ...(verification.policySnapshotJson ?? {}),
      evidencePolicy: issuePolicy,
      evidencePolicySource: asEvidencePolicySource(issue.evidencePolicySource),
      maxRepairAttempts,
      requiresHumanArtifacts: issuePolicy === "code_ci_evaluator_summary_artifacts",
    };
    const reviewReadyAt =
      verification.verificationVerdict === "pass" && reviewReadySatisfied(issuePolicy, bundle)
        ? verification.finishedAt ?? new Date()
        : null;
    const artifactBundleJson = {
      ...(verification.artifactBundleJson ?? {}),
      ...bundle,
    };

    await db
      .update(heartbeatRuns)
      .set({
        policySnapshotJson: policySnapshot,
        artifactBundleJson,
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, verification.id));

    await db
      .update(issues)
      .set({
        reviewReadyAt,
        lastVerificationRunId: verification.id,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, issue.id));

    return {
      issueId: issue.id,
      reviewReadyAt,
      verificationVerdict: (verification.verificationVerdict ?? null) as VerificationVerdict | null,
      policySnapshot,
      bundle: artifactBundleJson,
    };
  }

  async function synthesizePlannerReview(rootRunId: string) {
    const planner = await getVerificationRunById(rootRunId);
    if (!planner || planner.runType !== "planner") return null;

    const workers = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.rootRunId, planner.id), eq(heartbeatRuns.runType, "worker")))
      .orderBy(asc(heartbeatRuns.createdAt), asc(heartbeatRuns.id));

    if (workers.length === 0) return null;

    const decisions: SwarmReviewerDecisionRecord[] = [];
    let pending = false;

    for (const worker of workers) {
      const subtask = readSwarmSubtask(worker.contextSnapshot);
      await persistStructuredChildOutputArtifacts({
        companyId: worker.companyId,
        runId: worker.id,
        issueId: readIssueId(worker.contextSnapshot),
        resultJson: worker.resultJson,
        role: subtask?.kind ?? null,
      });
      const artifacts = await listRunArtifacts(worker.id);
      const artifactItems = artifacts.map(toArtifactItem);
      const childOutput = readStructuredChildOutput(worker.resultJson);
      const requiredArtifactKinds = readRequiredArtifactKinds(subtask);
      const presentKinds = new Set(artifactItems.map((artifact) => artifact.artifactKind));
      const missingRequiredArtifactKinds = requiredArtifactKinds.filter((kind) => !presentKinds.has(kind));
      const verification = await db
        .select()
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.parentRunId, worker.id), eq(heartbeatRuns.runType, "verification")))
        .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (worker.status === "queued" || worker.status === "running") pending = true;
      if (verification && (verification.status === "queued" || verification.status === "running")) pending = true;

      const reasons: string[] = [];
      let decision: SwarmReviewerDecision = "accept";
      if (worker.status !== "succeeded") {
        decision = "reject";
        reasons.push(`worker_${worker.status}`);
      }
      if (!childOutput) {
        decision = decision === "reject" ? decision : "request_repair";
        reasons.push("missing_structured_child_output");
      }
      if (missingRequiredArtifactKinds.length > 0) {
        decision = decision === "reject" ? decision : "request_repair";
        reasons.push(`missing_required_artifacts:${missingRequiredArtifactKinds.join(",")}`);
      }
      if (verification?.verificationVerdict === "repair") {
        decision = decision === "reject" ? decision : "request_repair";
        reasons.push("verification_requested_repair");
      }
      if (verification?.verificationVerdict === "fail_terminal") {
        decision = "reject";
        reasons.push("verification_failed_terminal");
      }
      if (verification && !verification.verificationVerdict) {
        pending = true;
      }
      if (reasons.length === 0) reasons.push("accepted");

      const reviewerDecision: SwarmReviewerDecisionRecord = {
        workerRunId: worker.id,
        subtaskId: subtask?.id ?? null,
        taskKey: typeof worker.contextSnapshot?.taskKey === "string" ? worker.contextSnapshot.taskKey : null,
        decision,
        reasons,
        summary: childOutput?.summary ?? null,
        verificationRunId: verification?.id ?? null,
        verificationVerdict: (verification?.verificationVerdict ?? null) as VerificationVerdict | null,
        acceptedArtifacts: decision === "accept" ? artifactItems : [],
      };
      decisions.push(reviewerDecision);

      const workerArtifactBundleJson: OrchestrationArtifactBundle = {
        ...(worker.artifactBundleJson ?? {}),
        artifacts: artifactItems,
        childOutput,
        reviewerDecision,
      };
      await db
        .update(heartbeatRuns)
        .set({
          artifactBundleJson: workerArtifactBundleJson,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, worker.id));
    }

    const acceptedArtifacts = decisions.flatMap((decision) => decision.acceptedArtifacts ?? []);
    const synthesis: SwarmPlannerSynthesis = {
      status: pending ? "pending" : "complete",
      generatedAt: new Date().toISOString(),
      summary: summarizeSynthesis(decisions),
      acceptedChildCount: decisions.filter((decision) => decision.decision === "accept").length,
      requestRepairChildCount: decisions.filter((decision) => decision.decision === "request_repair").length,
      rejectedChildCount: decisions.filter((decision) => decision.decision === "reject").length,
      acceptedArtifacts,
    };

    const plannerArtifactBundleJson: OrchestrationArtifactBundle = {
      ...(planner.artifactBundleJson ?? {}),
      reviewerDecisions: decisions,
      synthesis,
      artifacts: acceptedArtifacts,
      evaluatorSummary: synthesis.summary,
    };

    await db
      .update(heartbeatRuns)
      .set({
        artifactBundleJson: plannerArtifactBundleJson,
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, planner.id));

    return {
      plannerRunId: planner.id,
      reviewerDecisions: decisions,
      synthesis,
    };
  }

  return {
    getIssueEvidenceBundle,
    persistReportedRunArtifacts,
    syncVerificationOutcome,
    synthesizePlannerReview,
  };
}

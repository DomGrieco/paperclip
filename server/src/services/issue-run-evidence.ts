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

    return db
      .insert(heartbeatRunArtifacts)
      .values(
        input.artifacts.map((artifact) => ({
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

  return {
    getIssueEvidenceBundle,
    persistReportedRunArtifacts,
    syncVerificationOutcome,
  };
}

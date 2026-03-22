import type {
  EvidencePolicy,
  EvidencePolicySource,
  HeartbeatRunStatus,
  HeartbeatRunType,
  VerificationVerdict,
} from "../constants.js";

export interface OrchestrationPolicySnapshot {
  evidencePolicy: EvidencePolicy;
  evidencePolicySource: EvidencePolicySource;
  maxRepairAttempts?: number | null;
  requiresHumanArtifacts?: boolean | null;
  [key: string]: unknown;
}

export interface HeartbeatRunArtifact {
  id: string;
  companyId: string;
  runId: string;
  issueId: string | null;
  artifactKind: string;
  role: string | null;
  label: string | null;
  assetId: string | null;
  documentId: string | null;
  issueWorkProductId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface OrchestrationArtifactBundleItem {
  artifactId: string;
  artifactKind: string;
  role?: string | null;
  label?: string | null;
  assetId?: string | null;
  documentId?: string | null;
  issueWorkProductId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface OrchestrationArtifactBundle {
  evaluatorSummary?: string | null;
  verdict?: VerificationVerdict | null;
  artifacts?: OrchestrationArtifactBundleItem[];
  [key: string]: unknown;
}

export interface IssueEvidenceBundle {
  policy: EvidencePolicy;
  policySource: EvidencePolicySource;
  reviewReadyAt: Date | null;
  lastVerificationRunId: string | null;
  bundle: OrchestrationArtifactBundle | null;
}

export interface IssueRunGraphSummaryNode {
  id: string;
  runType: HeartbeatRunType;
  status: HeartbeatRunStatus;
  parentRunId: string | null;
  rootRunId: string | null;
  graphDepth: number;
  repairAttempt: number;
  verificationVerdict: VerificationVerdict | null;
}

export interface IssueOrchestrationSummary {
  rootRunId: string | null;
  lastVerificationRunId: string | null;
  reviewReadyAt: Date | null;
  evidencePolicy: EvidencePolicy;
  evidencePolicySource: EvidencePolicySource;
  evidenceBundle?: IssueEvidenceBundle | null;
  nodes: IssueRunGraphSummaryNode[];
}

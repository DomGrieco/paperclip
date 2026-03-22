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

export type RuntimeBundleTarget = "codex" | "cursor" | "opencode";
export type RuntimeBundleTddMode = "required";

export interface RuntimeBundlePolicy {
  tddMode: RuntimeBundleTddMode;
  evidencePolicy: EvidencePolicy;
  evidencePolicySource: EvidencePolicySource;
}

export interface RuntimeBundleMemorySnippet {
  scope: "company" | "agent" | "project" | "issue" | "run";
  source: string;
  sourceId?: string | null;
  content: string;
  freshness?: "static" | "recent" | "live" | null;
  updatedAt?: string | null;
  rank?: number | null;
}

export interface RuntimeBundleMemoryPacket {
  snippets: RuntimeBundleMemorySnippet[];
}

export interface RuntimeBundleRunner {
  target: "local_host" | "adapter_managed" | "cloud_sandbox";
  provider: "local_process" | "adapter_managed" | "cloud_sandbox";
  workspaceStrategyType: string | null;
  executionMode: string | null;
  browserCapable: boolean;
  sandboxed: boolean;
  isolationBoundary: "host_process" | "adapter_runtime" | "cloud_sandbox";
}

export interface RuntimeBundleProjection {
  runtime: RuntimeBundleTarget;
  contextKey: string;
  envVar: string;
  materializationRoot: string;
}

export interface RuntimeBundle {
  runtime: RuntimeBundleTarget;
  company: {
    id: string;
  };
  agent: {
    id: string;
    name: string;
    adapterType: string | null;
  };
  project: {
    id: string;
    name: string;
    executionWorkspacePolicy: Record<string, unknown> | null;
  } | null;
  issue: {
    id: string;
    identifier: string | null;
    title: string;
    status: string;
    priority: string;
  } | null;
  run: {
    id: string | null;
  };
  policy: RuntimeBundlePolicy;
  runner: RuntimeBundleRunner;
  memory: RuntimeBundleMemoryPacket;
  projection: RuntimeBundleProjection;
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

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

export type RuntimeBundleTarget = "codex" | "cursor" | "opencode" | "hermes";
export type RuntimeBundleTddMode = "required";

export interface RuntimeBundlePolicy {
  tddMode: RuntimeBundleTddMode;
  evidencePolicy: EvidencePolicy;
  evidencePolicySource: EvidencePolicySource;
  maxRepairAttempts: number;
  requiresHumanArtifacts: boolean;
}

export interface RuntimeBundleRun {
  id: string | null;
  runType: HeartbeatRunType | null;
  rootRunId: string | null;
  parentRunId: string | null;
  graphDepth: number | null;
  repairAttempt: number;
  verificationVerdict: VerificationVerdict | null;
}

export interface RuntimeBundleVerification {
  required: boolean;
  requiresEvaluatorSummary: boolean;
  requiresArtifacts: boolean;
  latestVerificationRunId: string | null;
  reviewReadyAt: string | null;
  runner: RuntimeBundleRunner;
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

export interface PaperclipSharedContextScope {
  companyId: string;
  projectId: string | null;
  issueId: string | null;
  runId: string | null;
  agentId: string;
}

export interface PaperclipSharedContextProvenance {
  source: "runtime_bundle";
  workspaceCwd: string;
  runtimeBundleRoot: string | null;
  runtimeInstructionsPath: string | null;
  sharedContextPath: string | null;
}

export interface PaperclipSharedContextPacket {
  version: "v1";
  scope: PaperclipSharedContextScope;
  policy: RuntimeBundlePolicy;
  runner: RuntimeBundleRunner;
  verification: RuntimeBundleVerification;
  memory: RuntimeBundleMemoryPacket;
  provenance: PaperclipSharedContextProvenance;
}

export interface RuntimeBundleRunner {
  target: "local_host" | "adapter_managed" | "cloud_sandbox" | "hermes_container";
  provider: "local_process" | "adapter_managed" | "cloud_sandbox" | "hermes_container";
  workspaceStrategyType: string | null;
  executionMode: string | null;
  browserCapable: boolean;
  sandboxed: boolean;
  isolationBoundary: "host_process" | "adapter_runtime" | "container_process" | "cloud_sandbox";
}

export interface HermesContainerMountPlan {
  kind: "workspace" | "agent_home" | "runtime_bundle" | "shared_auth";
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
  purpose: string;
}

export interface HermesContainerEnvPlan {
  name: string;
  value: string;
  secret: boolean;
  source:
    | "paperclip_runtime"
    | "resolved_config"
    | "runtime_bundle"
    | "shared_auth"
    | "worker_home";
}

export interface HermesContainerLaunchPlan {
  version: "v1";
  runner: RuntimeBundleRunner;
  image: string;
  command: string[];
  workingDir: string;
  workspacePath: string;
  agentHomePath: string;
  sharedAuthSourcePath: string | null;
  runtimeBundleRoot: string | null;
  sharedContextPath: string | null;
  provider: string | null;
  model: string | null;
  mounts: HermesContainerMountPlan[];
  env: HermesContainerEnvPlan[];
  runtimeService: {
    serviceName: string;
    provider: "hermes_container";
    scopeType: "run";
    scopeId: string;
    ownerAgentId: string;
  };
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
  run: RuntimeBundleRun;
  policy: RuntimeBundlePolicy;
  runner: RuntimeBundleRunner;
  verification: RuntimeBundleVerification;
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
  runnerSnapshotJson?: RuntimeBundleRunner | null;
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

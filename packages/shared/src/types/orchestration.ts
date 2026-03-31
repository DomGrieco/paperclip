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
export type SwarmSubtaskKind = "research" | "implementation" | "verification" | "review";
export type SwarmArtifactKind = "summary" | "patch" | "test_result" | "comment" | "document";
export type SwarmModelTier = "cheap" | "balanced" | "premium";
export type SwarmPathOwnershipMode = "exclusive" | "advisory" | "read_only";

export interface SwarmArtifactRequirement {
  kind: SwarmArtifactKind;
  required: boolean;
}

export interface SwarmSubtask {
  id: string;
  kind: SwarmSubtaskKind;
  title: string;
  goal: string;
  taskKey?: string | null;
  allowedPaths?: string[] | null;
  forbiddenPaths?: string[] | null;
  ownershipMode?: SwarmPathOwnershipMode | null;
  expectedArtifacts: SwarmArtifactRequirement[];
  acceptanceChecks: string[];
  recommendedModelTier: SwarmModelTier;
  budgetCents?: number | null;
  maxRuntimeSec?: number | null;
  dependsOn?: string[] | null;
}

export interface SwarmPlan {
  version: "v1";
  plannerRunId?: string | null;
  generatedAt?: string | null;
  rationale?: string | null;
  subtasks: SwarmSubtask[];
}

export interface RuntimeBundleSwarmWorkspaceGuard {
  enforcedMode: "shared_workspace" | "isolated_workspace" | "operator_branch" | "agent_default";
  warnings: string[];
  errors: string[];
}

export interface RuntimeBundleSwarm {
  plan: SwarmPlan | null;
  currentSubtask: SwarmSubtask | null;
  workspaceGuard?: RuntimeBundleSwarmWorkspaceGuard | null;
}

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

export type SharedContextPublicationVisibility =
  | "company"
  | "project"
  | "issue"
  | "agent_set";

export type SharedContextPublicationStatus =
  | "published"
  | "proposed"
  | "archived";

export type SharedContextFreshness = "static" | "recent" | "live";

export interface SharedContextPublication {
  id: string;
  companyId: string;
  projectId: string | null;
  issueId: string | null;
  sourceAgentId: string | null;
  createdByRunId: string | null;
  title: string;
  summary: string | null;
  body: string;
  tags: string[];
  visibility: SharedContextPublicationVisibility;
  audienceAgentIds: string[];
  status: SharedContextPublicationStatus;
  freshness: SharedContextFreshness;
  freshnessAt: string;
  confidence: number | null;
  rank: number;
  provenance: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
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

export interface PaperclipSharedContextManagedSkill {
  name: string;
  sourceType: "builtin" | "company" | "project" | "agent";
  sourceLabel: string;
  managedSkillId: string | null;
  scopeId: string | null;
}

export interface PaperclipSharedContextPacket {
  version: "v1";
  scope: PaperclipSharedContextScope;
  policy: RuntimeBundlePolicy;
  runner: RuntimeBundleRunner;
  verification: RuntimeBundleVerification;
  memory: RuntimeBundleMemoryPacket;
  managedSkills: {
    skillsDir: string | null;
    entries: PaperclipSharedContextManagedSkill[];
  } | null;
  provenance: PaperclipSharedContextProvenance;
}

export interface RuntimeBundleRunner {
  target: "local_host" | "adapter_managed" | "cloud_sandbox" | "hermes_container" | "agent_container";
  provider: "local_process" | "adapter_managed" | "cloud_sandbox" | "hermes_container" | "agent_container";
  workspaceStrategyType: string | null;
  executionMode: string | null;
  browserCapable: boolean;
  sandboxed: boolean;
  isolationBoundary: "host_process" | "adapter_runtime" | "container_process" | "cloud_sandbox";
}

export interface HermesBootstrapImportSummary {
  sourceHomePath: string;
  hasAuthJson: boolean;
  hasConfigYaml: boolean;
  hasEnvFile: boolean;
  activeProvider: string | null;
  authProviderIds: string[];
  configuredProvider: string | null;
  defaultModel: string | null;
  configuredBaseUrl: string | null;
  terminalBackend: string | null;
  terminalCwd: string | null;
  mcpServerNames: string[];
  enabledPlatforms: string[];
  enabledToolsets: string[];
  secretEnvKeys: string[];
}

export interface AgentContainerMountPlan {
  kind: "workspace" | "agent_home" | "runtime_bundle" | "shared_auth" | "managed_runtime";
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
  purpose: string;
}

export interface AgentContainerEnvPlan {
  name: string;
  value: string;
  secret: boolean;
  source:
    | "paperclip_runtime"
    | "resolved_config"
    | "runtime_bundle"
    | "shared_auth"
    | "managed_runtime"
    | "worker_home";
}

export interface AgentContainerLaunchPlan {
  version: "v1";
  adapterType: string;
  runner: RuntimeBundleRunner;
  image: string;
  command: string[];
  workingDir: string;
  workspacePath: string;
  nativeHomePath: string;
  nativeSkillsPath: string | null;
  agentHomePath: string;
  sharedAuthSourcePath: string | null;
  runtimeBundleRoot: string | null;
  sharedContextPath: string | null;
  provider: string | null;
  model: string | null;
  mounts: AgentContainerMountPlan[];
  env: AgentContainerEnvPlan[];
  runtimeService: {
    serviceName: string;
    provider: "hermes_container" | "agent_container";
    scopeType: "run";
    scopeId: string;
    ownerAgentId: string;
  };
}

export type HermesContainerMountPlan = AgentContainerMountPlan;
export type HermesContainerEnvPlan = AgentContainerEnvPlan;
export type HermesContainerLaunchPlan = AgentContainerLaunchPlan;

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
  swarm: RuntimeBundleSwarm;
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

export type SwarmReviewerDecision = "accept" | "request_repair" | "reject";

export interface StructuredChildOutputArtifactClaim {
  kind: string;
  label?: string | null;
  detail?: string | null;
}

export interface StructuredChildOutput {
  summary: string;
  status?: "completed" | "blocked" | null;
  notes?: string[];
  artifactClaims?: StructuredChildOutputArtifactClaim[];
}

export interface SwarmReviewerDecisionRecord {
  workerRunId: string;
  subtaskId?: string | null;
  taskKey?: string | null;
  decision: SwarmReviewerDecision;
  reasons: string[];
  summary?: string | null;
  verificationRunId?: string | null;
  verificationVerdict?: VerificationVerdict | null;
  acceptedArtifacts?: OrchestrationArtifactBundleItem[];
}

export interface SwarmPlannerSynthesis {
  status: "pending" | "complete";
  generatedAt: string;
  summary: string;
  acceptedChildCount: number;
  requestRepairChildCount: number;
  rejectedChildCount: number;
  acceptedArtifacts: OrchestrationArtifactBundleItem[];
}

export interface OrchestrationArtifactBundle {
  evaluatorSummary?: string | null;
  verdict?: VerificationVerdict | null;
  artifacts?: OrchestrationArtifactBundleItem[];
  childOutput?: StructuredChildOutput | null;
  reviewerDecision?: SwarmReviewerDecisionRecord | null;
  reviewerDecisions?: SwarmReviewerDecisionRecord[];
  synthesis?: SwarmPlannerSynthesis | null;
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
  artifactBundleJson?: OrchestrationArtifactBundle | null;
}

export interface IssueOrchestrationSummary {
  rootRunId: string | null;
  lastVerificationRunId: string | null;
  reviewReadyAt: Date | null;
  evidencePolicy: EvidencePolicy;
  evidencePolicySource: EvidencePolicySource;
  evidenceBundle?: IssueEvidenceBundle | null;
  issueSharedContextPublications?: SharedContextPublication[];
  nodes: IssueRunGraphSummaryNode[];
}

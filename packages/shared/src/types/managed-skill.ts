export type ManagedSkillStatus = "active" | "pending_review" | "archived";
export type ManagedSkillScopeType = "company" | "project" | "agent";
export type ManagedSkillEffectiveSourceType = "builtin" | ManagedSkillScopeType;

export interface ManagedSkill {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  description: string | null;
  bodyMarkdown: string;
  status: ManagedSkillStatus;
  importedFromAgentId: string | null;
  importedFromRunId: string | null;
  importedSourcePath: string | null;
  importedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ManagedSkillScopeAssignment {
  id: string;
  skillId: string;
  companyId: string;
  scopeType: ManagedSkillScopeType;
  scopeId: string | null;
  projectId: string | null;
  agentId: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ManagedSkillRecord {
  skill: ManagedSkill;
  scopes: ManagedSkillScopeAssignment[];
}

export interface ManagedSkillEffectivePreviewCandidate {
  sourceType: ManagedSkillEffectiveSourceType;
  sourceLabel: string;
  managedSkillId: string | null;
  scopeId: string | null;
  managedSkillSlug: string | null;
  managedSkillUpdatedAt: Date | null;
  resolutionRank: number;
}

export interface ManagedSkillEffectivePreviewEntry {
  name: string;
  description: string | null;
  bodyMarkdown: string;
  sourceType: ManagedSkillEffectiveSourceType;
  sourceLabel: string;
  managedSkillId: string | null;
  scopeId: string | null;
  managedSkillSlug: string | null;
  managedSkillUpdatedAt: Date | null;
  resolutionRank: number;
  candidates: ManagedSkillEffectivePreviewCandidate[];
}

export interface ManagedSkillEffectivePreviewResponse {
  companyId: string;
  projectId: string | null;
  agentId: string | null;
  generatedAt: Date;
  counts: {
    total: number;
    builtin: number;
    managed: number;
  };
  entries: ManagedSkillEffectivePreviewEntry[];
}

import type {
  CreateManagedSkill,
  ManagedSkill,
  ManagedSkillEffectivePreviewEntry,
  ManagedSkillScopeAssignment,
  ManagedSkillScopeAssignmentInput,
  UpdateManagedSkill,
} from "@paperclipai/shared";
import { api } from "./client";

export const managedSkillsApi = {
  list: (companyId: string) => api.get<ManagedSkill[]>(`/companies/${companyId}/managed-skills`),
  create: (companyId: string, data: CreateManagedSkill) =>
    api.post<ManagedSkill>(`/companies/${companyId}/managed-skills`, data),
  get: (companyId: string, skillId: string) =>
    api.get<ManagedSkill>(`/companies/${companyId}/managed-skills/${skillId}`),
  update: (companyId: string, skillId: string, data: UpdateManagedSkill) =>
    api.patch<ManagedSkill>(`/companies/${companyId}/managed-skills/${skillId}`, data),
  listScopes: (companyId: string, skillId: string) =>
    api.get<ManagedSkillScopeAssignment[]>(`/companies/${companyId}/managed-skills/${skillId}/scopes`),
  replaceScopes: (companyId: string, skillId: string, assignments: ManagedSkillScopeAssignmentInput[]) =>
    api.put<ManagedSkillScopeAssignment[]>(`/companies/${companyId}/managed-skills/${skillId}/scopes`, { assignments }),
  effectivePreview: (companyId: string, filters?: { projectId?: string | null; agentId?: string | null }) => {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.agentId) params.set("agentId", filters.agentId);
    const qs = params.toString();
    return api.get<{
      companyId: string;
      projectId: string | null;
      agentId: string | null;
      entries: ManagedSkillEffectivePreviewEntry[];
    }>(`/companies/${companyId}/managed-skills/effective-preview${qs ? `?${qs}` : ""}`);
  },
};

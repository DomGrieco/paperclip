import { z } from "zod";

export const MANAGED_SKILL_STATUSES = ["active", "archived"] as const;
export const MANAGED_SKILL_SCOPE_TYPES = ["company", "project", "agent"] as const;

export const managedSkillStatusSchema = z.enum(MANAGED_SKILL_STATUSES);
export const managedSkillScopeTypeSchema = z.enum(MANAGED_SKILL_SCOPE_TYPES);

export const createManagedSkillSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:[a-z0-9-_]*[a-z0-9])?$/).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  bodyMarkdown: z.string().trim().min(1).max(131072),
  status: managedSkillStatusSchema.optional().default("active"),
});

export const updateManagedSkillSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:[a-z0-9-_]*[a-z0-9])?$/).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  bodyMarkdown: z.string().trim().min(1).max(131072).optional(),
  status: managedSkillStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one managed-skill field must be provided",
});

export const managedSkillScopeAssignmentInputSchema = z.object({
  scopeType: managedSkillScopeTypeSchema,
  projectId: z.string().uuid().optional().nullable(),
  agentId: z.string().uuid().optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.scopeType === "company") {
    if (value.projectId || value.agentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Company scope cannot include projectId or agentId" });
    }
    return;
  }
  if (value.scopeType === "project") {
    if (!value.projectId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Project scope requires projectId" });
    }
    if (value.agentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Project scope cannot include agentId" });
    }
    return;
  }
  if (value.scopeType === "agent") {
    if (!value.agentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Agent scope requires agentId" });
    }
    if (value.projectId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Agent scope cannot include projectId" });
    }
  }
});

export const putManagedSkillScopesSchema = z.object({
  assignments: z.array(managedSkillScopeAssignmentInputSchema).max(256),
});

export const managedSkillEffectivePreviewQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
});

export type CreateManagedSkill = z.infer<typeof createManagedSkillSchema>;
export type UpdateManagedSkill = z.infer<typeof updateManagedSkillSchema>;
export type ManagedSkillScopeAssignmentInput = z.infer<typeof managedSkillScopeAssignmentInputSchema>;
export type PutManagedSkillScopes = z.infer<typeof putManagedSkillScopesSchema>;
export type ManagedSkillEffectivePreviewQuery = z.infer<typeof managedSkillEffectivePreviewQuerySchema>;

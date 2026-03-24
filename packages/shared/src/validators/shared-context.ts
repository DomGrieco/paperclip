import { z } from "zod";

export const SHARED_CONTEXT_VISIBILITIES = ["company", "project", "issue", "agent_set"] as const;
export const SHARED_CONTEXT_STATUSES = ["published", "proposed", "archived"] as const;
export const SHARED_CONTEXT_FRESHNESS = ["static", "recent", "live"] as const;

export const sharedContextVisibilitySchema = z.enum(SHARED_CONTEXT_VISIBILITIES);
export const sharedContextStatusSchema = z.enum(SHARED_CONTEXT_STATUSES);
export const sharedContextFreshnessSchema = z.enum(SHARED_CONTEXT_FRESHNESS);

export const createSharedContextPublicationSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  issueId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).optional().nullable(),
  body: z.string().trim().min(1).max(32768),
  tags: z.array(z.string().trim().min(1).max(64)).max(32).optional().nullable(),
  visibility: sharedContextVisibilitySchema.optional().default("project"),
  audienceAgentIds: z.array(z.string().uuid()).max(64).optional().nullable(),
  status: sharedContextStatusSchema.optional(),
  freshness: sharedContextFreshnessSchema.optional().default("recent"),
  freshnessAt: z.string().datetime().optional().nullable(),
  confidence: z.number().int().min(0).max(100).optional().nullable(),
  rank: z.number().int().min(0).max(1000).optional(),
  provenance: z.record(z.unknown()).optional().nullable(),
});

export const updateSharedContextPublicationSchema = z.object({
  status: sharedContextStatusSchema,
});

export type CreateSharedContextPublication = z.infer<typeof createSharedContextPublicationSchema>;
export type UpdateSharedContextPublication = z.infer<typeof updateSharedContextPublicationSchema>;

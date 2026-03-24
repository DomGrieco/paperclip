import { z } from "zod";

export const swarmSubtaskKindSchema = z.enum([
  "research",
  "implementation",
  "verification",
  "review",
]);

export const swarmArtifactKindSchema = z.enum([
  "summary",
  "patch",
  "test_result",
  "comment",
  "document",
]);

export const swarmModelTierSchema = z.enum([
  "cheap",
  "balanced",
  "premium",
]);

export const swarmPathOwnershipModeSchema = z.enum([
  "exclusive",
  "advisory",
  "read_only",
]);

export const swarmArtifactRequirementSchema = z.object({
  kind: swarmArtifactKindSchema,
  required: z.boolean(),
});

export const swarmSubtaskSchema = z.object({
  id: z.string().min(1),
  kind: swarmSubtaskKindSchema,
  title: z.string().min(1),
  goal: z.string().min(1),
  taskKey: z.string().min(1).nullable().optional(),
  allowedPaths: z.array(z.string().min(1)).nullable().optional(),
  forbiddenPaths: z.array(z.string().min(1)).nullable().optional(),
  ownershipMode: swarmPathOwnershipModeSchema.nullable().optional(),
  expectedArtifacts: z.array(swarmArtifactRequirementSchema),
  acceptanceChecks: z.array(z.string().min(1)),
  recommendedModelTier: swarmModelTierSchema,
  budgetCents: z.number().int().nonnegative().nullable().optional(),
  maxRuntimeSec: z.number().int().positive().nullable().optional(),
  dependsOn: z.array(z.string().min(1)).nullable().optional(),
});

export const swarmPlanSchema = z.object({
  version: z.literal("v1"),
  plannerRunId: z.string().uuid().nullable().optional(),
  generatedAt: z.string().datetime().nullable().optional(),
  rationale: z.string().nullable().optional(),
  subtasks: z.array(swarmSubtaskSchema),
});

export type SwarmSubtaskInput = z.infer<typeof swarmSubtaskSchema>;
export type SwarmPlanInput = z.infer<typeof swarmPlanSchema>;

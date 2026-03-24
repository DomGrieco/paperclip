import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { sharedContextPublications } from "@paperclipai/db";
import type {
  CreateSharedContextPublication,
  RuntimeBundleMemorySnippet,
  SharedContextFreshness,
  SharedContextPublication,
  SharedContextPublicationStatus,
  SharedContextPublicationVisibility,
} from "@paperclipai/shared";
import { unprocessable } from "../errors.js";

function mapPublication(row: typeof sharedContextPublications.$inferSelect): SharedContextPublication {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId,
    issueId: row.issueId,
    sourceAgentId: row.sourceAgentId,
    createdByRunId: row.createdByRunId,
    title: row.title,
    summary: row.summary,
    body: row.body,
    tags: row.tags ?? [],
    visibility: row.visibility as SharedContextPublicationVisibility,
    audienceAgentIds: row.audienceAgentIds ?? [],
    status: row.status as SharedContextPublicationStatus,
    freshness: row.freshness as SharedContextFreshness,
    freshnessAt: row.freshnessAt.toISOString(),
    confidence: row.confidence,
    rank: row.rank,
    provenance: row.provenance ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeVisibilityInput(input: CreateSharedContextPublication) {
  const visibility = input.visibility ?? "project";
  if (visibility === "issue" && !input.issueId) {
    throw unprocessable("Issue-scoped shared context requires issueId");
  }
  if (visibility === "project" && !input.projectId) {
    throw unprocessable("Project-scoped shared context requires projectId");
  }
  if (visibility === "agent_set" && (!input.audienceAgentIds || input.audienceAgentIds.length === 0)) {
    throw unprocessable("Agent-set shared context requires audienceAgentIds");
  }
  return visibility;
}

function resolvePublicationStatus(input: {
  actorType: "board" | "agent";
  requestedStatus: SharedContextPublicationStatus | undefined;
  visibility: SharedContextPublicationVisibility;
}): SharedContextPublicationStatus {
  const requested = input.requestedStatus ?? "published";
  if (input.actorType === "board") return requested;
  if (requested === "archived") return "proposed";
  if (input.visibility === "issue" || input.visibility === "project") {
    return requested;
  }
  return "proposed";
}

function toRuntimeSnippet(
  row: typeof sharedContextPublications.$inferSelect,
): RuntimeBundleMemorySnippet {
  const visibility = row.visibility as SharedContextPublicationVisibility;
  const scope: RuntimeBundleMemorySnippet["scope"] = visibility === "project"
    ? "project"
    : visibility === "issue"
      ? "issue"
      : visibility === "agent_set"
        ? "agent"
        : "company";
  const parts = [
    row.title.trim().length > 0 ? `Title: ${row.title}` : null,
    row.summary?.trim().length ? `Summary: ${row.summary.trim()}` : null,
    row.body.trim().length > 0 ? row.body : null,
  ].filter((value): value is string => Boolean(value));
  return {
    scope,
    source: `shared_context.${visibility}`,
    sourceId: row.id,
    content: parts.join("\n\n"),
    freshness: row.freshness as RuntimeBundleMemorySnippet["freshness"],
    updatedAt: row.freshnessAt.toISOString(),
    rank: row.rank,
  };
}

export function sharedContextService(db: Db) {
  return {
    async create(
      companyId: string,
      input: CreateSharedContextPublication,
      actor: { type: "board" | "agent"; agentId?: string | null; runId?: string | null },
    ): Promise<SharedContextPublication> {
      const visibility = normalizeVisibilityInput(input) as SharedContextPublicationVisibility;
      const status = resolvePublicationStatus({
        actorType: actor.type,
        requestedStatus: input.status as SharedContextPublicationStatus | undefined,
        visibility,
      });
      const freshnessAt = input.freshnessAt ? new Date(input.freshnessAt) : new Date();
      const [row] = await db
        .insert(sharedContextPublications)
        .values({
          companyId,
          projectId: input.projectId ?? null,
          issueId: input.issueId ?? null,
          sourceAgentId: actor.type === "agent" ? actor.agentId ?? null : null,
          createdByRunId: actor.runId ?? null,
          title: input.title.trim(),
          summary: input.summary?.trim() || null,
          body: input.body.trim(),
          tags: input.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
          visibility,
          audienceAgentIds: input.audienceAgentIds ?? [],
          status,
          freshness: input.freshness ?? "recent",
          freshnessAt,
          confidence: input.confidence ?? null,
          rank: input.rank ?? 100,
          provenance: input.provenance ?? null,
          updatedAt: new Date(),
        })
        .returning();
      return mapPublication(row);
    },

    async list(
      companyId: string,
      filters: {
        projectId?: string;
        issueId?: string;
        sourceAgentId?: string;
        status?: SharedContextPublicationStatus;
        visibility?: SharedContextPublicationVisibility;
      } = {},
    ): Promise<SharedContextPublication[]> {
      const conditions = [eq(sharedContextPublications.companyId, companyId)];
      if (filters.projectId) conditions.push(eq(sharedContextPublications.projectId, filters.projectId));
      if (filters.issueId) conditions.push(eq(sharedContextPublications.issueId, filters.issueId));
      if (filters.sourceAgentId) conditions.push(eq(sharedContextPublications.sourceAgentId, filters.sourceAgentId));
      if (filters.status) conditions.push(eq(sharedContextPublications.status, filters.status));
      if (filters.visibility) conditions.push(eq(sharedContextPublications.visibility, filters.visibility));
      const rows = await db
        .select()
        .from(sharedContextPublications)
        .where(and(...conditions))
        .orderBy(desc(sharedContextPublications.freshnessAt), desc(sharedContextPublications.updatedAt));
      return rows.map(mapPublication);
    },

    async listRuntimeMemorySnippets(input: {
      companyId: string;
      agentId: string;
      projectId: string | null;
      issueId: string | null;
      limit?: number;
    }): Promise<RuntimeBundleMemorySnippet[]> {
      const visibilityClauses = [
        eq(sharedContextPublications.visibility, "company"),
        ...(input.projectId
          ? [
              and(
                eq(sharedContextPublications.visibility, "project"),
                eq(sharedContextPublications.projectId, input.projectId),
              ),
            ]
          : []),
        ...(input.issueId
          ? [
              and(
                eq(sharedContextPublications.visibility, "issue"),
                eq(sharedContextPublications.issueId, input.issueId),
              ),
            ]
          : []),
        sql<boolean>`(
          ${sharedContextPublications.visibility} = 'agent_set'
          and ${sharedContextPublications.audienceAgentIds} ? ${input.agentId}
        )`,
      ];
      const rows = await db
        .select()
        .from(sharedContextPublications)
        .where(
          and(
            eq(sharedContextPublications.companyId, input.companyId),
            eq(sharedContextPublications.status, "published"),
            or(...visibilityClauses),
          ),
        )
        .orderBy(
          sql`case
            when ${sharedContextPublications.visibility} = 'issue' then 0
            when ${sharedContextPublications.visibility} = 'project' then 1
            when ${sharedContextPublications.visibility} = 'agent_set' then 2
            else 3
          end`,
          asc(sharedContextPublications.rank),
          desc(sharedContextPublications.freshnessAt),
          desc(sharedContextPublications.updatedAt),
        )
        .limit(input.limit ?? 8);
      return rows.map(toRuntimeSnippet);
    },
  };
}

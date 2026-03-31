import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { managedSkillScopes, managedSkills } from "@paperclipai/db";
import { listPaperclipSkillEntries } from "@paperclipai/adapter-utils/server-utils";
import type {
  CreateManagedSkill,
  ManagedSkill,
  ManagedSkillEffectivePreviewEntry,
  ManagedSkillRecord,
  ManagedSkillScopeAssignment,
  ManagedSkillScopeAssignmentInput,
  ManagedSkillScopeType,
  ManagedSkillStatus,
  UpdateManagedSkill,
} from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";

export type EffectiveSkillSource = "builtin" | ManagedSkillScopeType;

export type EffectiveManagedSkill = {
  name: string;
  description: string | null;
  bodyMarkdown: string;
  sourceType: EffectiveSkillSource;
  sourceLabel: string;
  managedSkillId: string | null;
  scopeId: string | null;
};

export type MaterializedSkillDirectory = {
  skillsDir: string;
  skillsEntries: Array<{ name: string; source: string }>;
};

function parseSkillFrontmatter(markdown: string): { name: string | null; description: string | null } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return { name: null, description: null };
  const lines = match[1].split(/\r?\n/);
  let name: string | null = null;
  let description: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("name:")) {
      name = trimmed.slice("name:".length).trim() || null;
    } else if (trimmed.startsWith("description:")) {
      description = trimmed.slice("description:".length).trim() || null;
    }
  }
  return { name, description };
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeManagedSkillSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return normalized || "skill";
}

function scopeRank(sourceType: EffectiveSkillSource): number {
  switch (sourceType) {
    case "agent":
      return 4;
    case "project":
      return 3;
    case "company":
      return 2;
    case "builtin":
    default:
      return 1;
  }
}

function mapManagedSkill(row: typeof managedSkills.$inferSelect): ManagedSkill {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    bodyMarkdown: row.bodyMarkdown,
    status: row.status as ManagedSkillStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapManagedSkillScope(row: typeof managedSkillScopes.$inferSelect): ManagedSkillScopeAssignment {
  return {
    id: row.id,
    skillId: row.skillId,
    companyId: row.companyId,
    scopeType: row.scopeType as ManagedSkillScopeType,
    scopeId: row.scopeId,
    projectId: row.projectId,
    agentId: row.agentId,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toManagedSkillRecord(input: {
  skill: typeof managedSkills.$inferSelect;
  scopes: Array<typeof managedSkillScopes.$inferSelect>;
}): ManagedSkillRecord {
  return {
    skill: mapManagedSkill(input.skill),
    scopes: input.scopes.map(mapManagedSkillScope),
  };
}

function normalizeScopeAssignment(companyId: string, input: ManagedSkillScopeAssignmentInput) {
  if (input.scopeType === "company") {
    return {
      scopeType: "company" as const,
      scopeId: companyId,
      projectId: null,
      agentId: null,
    };
  }
  if (input.scopeType === "project") {
    return {
      scopeType: "project" as const,
      scopeId: input.projectId ?? null,
      projectId: input.projectId ?? null,
      agentId: null,
    };
  }
  return {
    scopeType: "agent" as const,
    scopeId: input.agentId ?? null,
    projectId: null,
    agentId: input.agentId ?? null,
  };
}

function dedupeScopeAssignments(companyId: string, assignments: ManagedSkillScopeAssignmentInput[]) {
  const unique = new Map<string, ReturnType<typeof normalizeScopeAssignment>>();
  for (const assignment of assignments) {
    const normalized = normalizeScopeAssignment(companyId, assignment);
    const key = [normalized.scopeType, normalized.projectId ?? "", normalized.agentId ?? ""].join(":");
    unique.set(key, normalized);
  }
  return Array.from(unique.values());
}

async function loadBuiltInSkills(moduleDir: string, additionalSkillDirs: string[] = []): Promise<EffectiveManagedSkill[]> {
  const entries = await listPaperclipSkillEntries(moduleDir, additionalSkillDirs);
  const skills = await Promise.all(
    entries.map(async (entry): Promise<EffectiveManagedSkill | null> => {
      const bodyMarkdown = await fs.readFile(path.join(entry.source, "SKILL.md"), "utf8").catch(() => null);
      if (!bodyMarkdown) return null;
      const frontmatter = parseSkillFrontmatter(bodyMarkdown);
      return {
        name: normalizeSkillName(frontmatter.name ?? entry.name),
        description: frontmatter.description,
        bodyMarkdown,
        sourceType: "builtin",
        sourceLabel: "builtin",
        managedSkillId: null,
        scopeId: null,
      };
    }),
  );
  return skills.filter((skill): skill is EffectiveManagedSkill => skill !== null);
}

export async function materializeEffectiveSkills(input: {
  outputRoot: string;
  skills: EffectiveManagedSkill[];
}): Promise<MaterializedSkillDirectory> {
  const skillsDir = path.resolve(input.outputRoot);
  await fs.rm(skillsDir, { recursive: true, force: true });
  await fs.mkdir(skillsDir, { recursive: true });

  const skillsEntries: Array<{ name: string; source: string }> = [];
  for (const skill of input.skills) {
    const name = normalizeSkillName(skill.name);
    const skillDir = path.join(skillsDir, name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), skill.bodyMarkdown, "utf8");
    skillsEntries.push({ name, source: skillDir });
  }

  return { skillsDir, skillsEntries };
}

export function managedSkillService(db: Db) {
  return {
    async listManagedSkills(companyId: string): Promise<ManagedSkill[]> {
      const rows = await db
        .select()
        .from(managedSkills)
        .where(eq(managedSkills.companyId, companyId))
        .orderBy(desc(managedSkills.updatedAt), desc(managedSkills.createdAt));
      return rows.map(mapManagedSkill);
    },

    async getManagedSkill(companyId: string, skillId: string): Promise<ManagedSkill> {
      const row = await db
        .select()
        .from(managedSkills)
        .where(and(eq(managedSkills.companyId, companyId), eq(managedSkills.id, skillId)))
        .then((rows) => rows[0] ?? null);
      if (!row) {
        throw notFound("Managed skill not found");
      }
      return mapManagedSkill(row);
    },

    async createManagedSkill(companyId: string, input: CreateManagedSkill): Promise<ManagedSkill> {
      const slug = normalizeManagedSkillSlug(input.slug ?? input.name);
      const [row] = await db
        .insert(managedSkills)
        .values({
          companyId,
          name: input.name.trim(),
          slug,
          description: input.description?.trim() || null,
          bodyMarkdown: input.bodyMarkdown.trim(),
          status: input.status ?? "active",
          updatedAt: new Date(),
        })
        .returning();
      return mapManagedSkill(row);
    },

    async updateManagedSkill(companyId: string, skillId: string, input: UpdateManagedSkill): Promise<ManagedSkill> {
      const existing = await db
        .select()
        .from(managedSkills)
        .where(and(eq(managedSkills.companyId, companyId), eq(managedSkills.id, skillId)))
        .then((rows) => rows[0] ?? null);
      if (!existing) {
        throw notFound("Managed skill not found");
      }

      const nextSlug = input.slug
        ? normalizeManagedSkillSlug(input.slug)
        : existing.slug;

      const [row] = await db
        .update(managedSkills)
        .set({
          name: input.name?.trim() ?? existing.name,
          slug: nextSlug,
          description: input.description === undefined ? existing.description : (input.description?.trim() || null),
          bodyMarkdown: input.bodyMarkdown?.trim() ?? existing.bodyMarkdown,
          status: input.status ?? (existing.status as ManagedSkillStatus),
          updatedAt: new Date(),
        })
        .where(and(eq(managedSkills.companyId, companyId), eq(managedSkills.id, skillId)))
        .returning();
      return mapManagedSkill(row);
    },

    async listManagedSkillScopes(companyId: string, skillId: string): Promise<ManagedSkillScopeAssignment[]> {
      await this.getManagedSkill(companyId, skillId);
      const rows = await db
        .select()
        .from(managedSkillScopes)
        .where(and(eq(managedSkillScopes.companyId, companyId), eq(managedSkillScopes.skillId, skillId), eq(managedSkillScopes.enabled, true)))
        .orderBy(desc(managedSkillScopes.updatedAt), desc(managedSkillScopes.createdAt));
      return rows.map(mapManagedSkillScope);
    },

    async replaceManagedSkillScopes(
      companyId: string,
      skillId: string,
      assignments: ManagedSkillScopeAssignmentInput[],
    ): Promise<ManagedSkillScopeAssignment[]> {
      await this.getManagedSkill(companyId, skillId);
      const normalizedAssignments = dedupeScopeAssignments(companyId, assignments);
      return await db.transaction(async (tx) => {
        await tx
          .delete(managedSkillScopes)
          .where(and(eq(managedSkillScopes.companyId, companyId), eq(managedSkillScopes.skillId, skillId)));
        if (normalizedAssignments.length === 0) {
          return [];
        }
        const rows = await tx
          .insert(managedSkillScopes)
          .values(
            normalizedAssignments.map((assignment) => ({
              skillId,
              companyId,
              scopeType: assignment.scopeType,
              scopeId: assignment.scopeId,
              projectId: assignment.projectId,
              agentId: assignment.agentId,
              enabled: true,
              updatedAt: new Date(),
            })),
          )
          .returning();
        return rows.map(mapManagedSkillScope);
      });
    },

    async getManagedSkillRecord(companyId: string, skillId: string): Promise<ManagedSkillRecord> {
      const skill = await db
        .select()
        .from(managedSkills)
        .where(and(eq(managedSkills.companyId, companyId), eq(managedSkills.id, skillId)))
        .then((rows) => rows[0] ?? null);
      if (!skill) {
        throw notFound("Managed skill not found");
      }
      const scopes = await db
        .select()
        .from(managedSkillScopes)
        .where(and(eq(managedSkillScopes.companyId, companyId), eq(managedSkillScopes.skillId, skillId), eq(managedSkillScopes.enabled, true)))
        .orderBy(desc(managedSkillScopes.updatedAt), desc(managedSkillScopes.createdAt));
      return toManagedSkillRecord({ skill, scopes });
    },

    async previewEffectiveSkills(input: {
      companyId: string;
      projectId?: string | null;
      agentId?: string | null;
      moduleDir: string;
      additionalBuiltInSkillDirs?: string[];
    }): Promise<ManagedSkillEffectivePreviewEntry[]> {
      const resolved = await this.resolveEffectiveSkills(input);
      return resolved.map((entry) => ({
        name: entry.name,
        description: entry.description,
        bodyMarkdown: entry.bodyMarkdown,
        sourceType: entry.sourceType,
        sourceLabel: entry.sourceLabel,
        managedSkillId: entry.managedSkillId,
        scopeId: entry.scopeId,
      }));
    },

    async resolveEffectiveSkills(input: {
      companyId: string;
      projectId?: string | null;
      agentId?: string | null;
      moduleDir: string;
      additionalBuiltInSkillDirs?: string[];
    }): Promise<EffectiveManagedSkill[]> {
      const builtIns = await loadBuiltInSkills(input.moduleDir, input.additionalBuiltInSkillDirs ?? []);

      const scopeConditions = [
        and(
          eq(managedSkillScopes.companyId, input.companyId),
          eq(managedSkillScopes.scopeType, "company"),
          eq(managedSkillScopes.enabled, true),
        ),
      ];
      if (input.projectId) {
        scopeConditions.push(
          and(
            eq(managedSkillScopes.companyId, input.companyId),
            eq(managedSkillScopes.scopeType, "project"),
            eq(managedSkillScopes.projectId, input.projectId),
            eq(managedSkillScopes.enabled, true),
          ),
        );
      }
      if (input.agentId) {
        scopeConditions.push(
          and(
            eq(managedSkillScopes.companyId, input.companyId),
            eq(managedSkillScopes.scopeType, "agent"),
            eq(managedSkillScopes.agentId, input.agentId),
            eq(managedSkillScopes.enabled, true),
          ),
        );
      }

      const allScopeRows = await db
        .select()
        .from(managedSkillScopes)
        .where(scopeConditions.length === 1 ? scopeConditions[0]! : or(...scopeConditions));

      const skillIds = Array.from(new Set(allScopeRows.map((row) => row.skillId)));
      const managedRows = skillIds.length > 0
        ? await db
            .select()
            .from(managedSkills)
            .where(and(inArray(managedSkills.id, skillIds), eq(managedSkills.status, "active")))
        : [];
      const managedById = new Map(managedRows.map((row) => [row.id, row]));

      const resolved = new Map<string, EffectiveManagedSkill>();
      for (const builtin of builtIns) {
        resolved.set(normalizeSkillName(builtin.name), builtin);
      }

      for (const scopeType of ["company", "project", "agent"] as const) {
        const scopedRows = allScopeRows.filter((row) => row.scopeType === scopeType);
        for (const scopeRow of scopedRows) {
          const managed = managedById.get(scopeRow.skillId);
          if (!managed) continue;
          const name = normalizeSkillName(managed.slug || managed.name);
          const candidate: EffectiveManagedSkill = {
            name,
            description: managed.description,
            bodyMarkdown: managed.bodyMarkdown,
            sourceType: scopeType,
            sourceLabel: scopeType,
            managedSkillId: managed.id,
            scopeId: scopeType === "company" ? managed.companyId : (scopeRow.scopeId ?? scopeRow.projectId ?? scopeRow.agentId ?? null),
          };
          const existing = resolved.get(name);
          if (!existing || scopeRank(candidate.sourceType) >= scopeRank(existing.sourceType)) {
            resolved.set(name, candidate);
          }
        }
      }

      return Array.from(resolved.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

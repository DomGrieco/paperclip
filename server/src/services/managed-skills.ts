import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { managedSkillScopes, managedSkills } from "@paperclipai/db";
import { listPaperclipSkillEntries } from "@paperclipai/adapter-utils/server-utils";

export type ManagedSkillStatus = "active" | "archived";
export type ManagedSkillScopeType = "company" | "project" | "agent";
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
    async listManagedSkills(companyId: string) {
      return await db
        .select()
        .from(managedSkills)
        .where(eq(managedSkills.companyId, companyId))
        .orderBy(desc(managedSkills.updatedAt), desc(managedSkills.createdAt));
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

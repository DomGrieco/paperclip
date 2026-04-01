import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { managedSkills } from "@paperclipai/db";
import { parseObject } from "../adapters/utils.js";
import { getAgentContainerProfile } from "./agent-container-profiles.js";

type SupportedAdapterType = "hermes_local" | "codex_local" | "cursor";

export type ImportedNativeSkillRecord = {
  id: string;
  name: string;
  slug: string;
  importedAt: Date;
  sourcePath: string;
};

function isSupportedAdapterType(adapterType: string): adapterType is SupportedAdapterType {
  return adapterType === "hermes_local" || adapterType === "codex_local" || adapterType === "cursor";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function resolveNativeHomeHostPath(input: {
  adapterType: SupportedAdapterType;
  executionWorkspaceCwd: string;
  executionConfig: Record<string, unknown>;
}): string {
  const profile = getAgentContainerProfile(input.adapterType);
  const env = parseObject(input.executionConfig.env);
  const configuredHome = readString(env[profile.homeEnvName]);
  if (configuredHome) return configuredHome;
  if (input.adapterType === "cursor") {
    return path.join(input.executionWorkspaceCwd, ".paperclip", "cursor-home");
  }
  return path.join(input.executionWorkspaceCwd, ".paperclip", `${profile.adapterType}-home`);
}

function resolveNativeSkillsHostPath(input: {
  adapterType: SupportedAdapterType;
  nativeHomeHostPath: string;
}): string | null {
  const profile = getAgentContainerProfile(input.adapterType);
  if (!profile.nativeSkillsPath) return null;
  const relative = path.posix.relative(profile.nativeHomePath, profile.nativeSkillsPath);
  if (!relative || relative === ".") return input.nativeHomeHostPath;
  return path.join(input.nativeHomeHostPath, ...relative.split(path.posix.sep));
}

async function listImportableNativeSkillDirs(skillsRoot: string): Promise<string[]> {
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  const importable: string[] = [];
  for (const entry of entries) {
    const sourcePath = path.join(skillsRoot, entry.name);
    const stat = await fs.lstat(sourcePath).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) continue;
    const skillMarkdownPath = path.join(sourcePath, "SKILL.md");
    const markdownExists = await fs.stat(skillMarkdownPath).then(() => true).catch(() => false);
    if (!markdownExists) continue;
    importable.push(sourcePath);
  }
  return importable;
}

export async function importNativeSkillsFromCompletedRun(db: Db, input: {
  companyId: string;
  agentId: string;
  runId: string;
  adapterType: string;
  executionWorkspaceCwd: string;
  executionConfig: Record<string, unknown>;
}): Promise<ImportedNativeSkillRecord[]> {
  if (!isSupportedAdapterType(input.adapterType)) {
    return [];
  }

  const nativeHomeHostPath = resolveNativeHomeHostPath({
    adapterType: input.adapterType,
    executionWorkspaceCwd: input.executionWorkspaceCwd,
    executionConfig: input.executionConfig,
  });
  const nativeSkillsHostPath = resolveNativeSkillsHostPath({
    adapterType: input.adapterType,
    nativeHomeHostPath,
  });
  if (!nativeSkillsHostPath) return [];

  const sourceDirs = await listImportableNativeSkillDirs(nativeSkillsHostPath);
  const imported: ImportedNativeSkillRecord[] = [];

  for (const sourcePath of sourceDirs) {
    const markdownPath = path.join(sourcePath, "SKILL.md");
    const bodyMarkdown = (await fs.readFile(markdownPath, "utf8").catch(() => null))?.trim() ?? null;
    if (!bodyMarkdown) continue;

    const frontmatter = parseSkillFrontmatter(bodyMarkdown);
    const folderName = path.basename(sourcePath);
    const name = frontmatter.name?.trim() || folderName;
    const description = frontmatter.description?.trim() || null;
    const slug = normalizeManagedSkillSlug(name || folderName);
    const importedAt = new Date();

    const existing = await db
      .select()
      .from(managedSkills)
      .where(and(eq(managedSkills.companyId, input.companyId), eq(managedSkills.importedSourcePath, sourcePath)))
      .then((rows) => rows[0] ?? null);

    if (existing) {
      if (existing.status !== "pending_review") continue;
      if (
        existing.bodyMarkdown === bodyMarkdown &&
        normalizeSkillName(existing.name) === normalizeSkillName(name) &&
        (existing.description ?? null) === description
      ) {
        continue;
      }

      const [updated] = await db
        .update(managedSkills)
        .set({
          name,
          slug,
          description,
          bodyMarkdown,
          importedFromAgentId: input.agentId,
          importedFromRunId: input.runId,
          importedAt,
          updatedAt: importedAt,
        })
        .where(eq(managedSkills.id, existing.id))
        .returning();
      imported.push({
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        importedAt,
        sourcePath,
      });
      continue;
    }

    const [created] = await db
      .insert(managedSkills)
      .values({
        companyId: input.companyId,
        name,
        slug,
        description,
        bodyMarkdown,
        status: "pending_review",
        importedFromAgentId: input.agentId,
        importedFromRunId: input.runId,
        importedSourcePath: sourcePath,
        importedAt,
        updatedAt: importedAt,
      })
      .returning();

    imported.push({
      id: created.id,
      name: created.name,
      slug: created.slug,
      importedAt,
      sourcePath,
    });
  }

  return imported;
}

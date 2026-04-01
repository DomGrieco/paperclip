import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { sharedContextPublications } from "@paperclipai/db";
import { parseObject } from "../adapters/utils.js";
import { resolveCompanySharedMemoryRoot } from "../home-paths.js";
import { getAgentContainerProfile } from "./agent-container-profiles.js";

type SupportedAdapterType = "hermes_local";
type NativeMemoryKind = "memory" | "user";

type NativeMemoryFile = {
  kind: NativeMemoryKind;
  title: string;
  summary: string;
  tags: string[];
  sourcePath: string;
  snapshotPath: string;
  body: string;
};

export type ImportedNativeMemoryRecord = {
  id: string;
  kind: NativeMemoryKind;
  title: string;
  sourcePath: string;
  snapshotPath: string;
  updatedAt: Date;
};

function isSupportedAdapterType(adapterType: string): adapterType is SupportedAdapterType {
  return adapterType === "hermes_local";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeMarkdownBody(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
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
  return path.join(input.executionWorkspaceCwd, ".paperclip", `${profile.adapterType}-home`);
}

async function resolveHermesNativeMemoryFiles(input: {
  companyId: string;
  agentId: string;
  nativeHomeHostPath: string;
}): Promise<NativeMemoryFile[]> {
  const memoriesRoot = path.join(input.nativeHomeHostPath, "memories");
  const snapshotRoot = path.join(resolveCompanySharedMemoryRoot(input.companyId), input.agentId, "hermes");
  const candidates: Array<{
    kind: NativeMemoryKind;
    fileName: string;
    title: string;
    summary: string;
    tags: string[];
  }> = [
    {
      kind: "memory",
      fileName: "MEMORY.md",
      title: "Hermes persistent memory",
      summary: "Imported from Hermes native MEMORY.md.",
      tags: ["native-memory", "hermes", "memory"],
    },
    {
      kind: "user",
      fileName: "USER.md",
      title: "Hermes user profile",
      summary: "Imported from Hermes native USER.md.",
      tags: ["native-memory", "hermes", "user-profile"],
    },
  ];

  const files: NativeMemoryFile[] = [];
  for (const candidate of candidates) {
    const sourcePath = path.join(memoriesRoot, candidate.fileName);
    const body = await fs.readFile(sourcePath, "utf8").catch(() => null);
    if (!body) continue;
    const normalizedBody = normalizeMarkdownBody(body);
    if (!normalizedBody) continue;
    files.push({
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      tags: candidate.tags,
      sourcePath,
      snapshotPath: path.join(snapshotRoot, candidate.fileName),
      body: normalizedBody,
    });
  }
  return files;
}

function matchesImportedNativeMemory(
  row: typeof sharedContextPublications.$inferSelect,
  input: { adapterType: SupportedAdapterType; kind: NativeMemoryKind; sourcePath: string },
): boolean {
  const provenance = parseObject(row.provenance);
  return provenance.type === "native_memory_import"
    && provenance.adapterType === input.adapterType
    && provenance.kind === input.kind
    && provenance.sourcePath === input.sourcePath;
}

export async function importNativeMemoryFromCompletedRun(db: Db, input: {
  companyId: string;
  agentId: string;
  runId: string;
  adapterType: string;
  executionWorkspaceCwd: string;
  executionConfig: Record<string, unknown>;
}): Promise<ImportedNativeMemoryRecord[]> {
  if (!isSupportedAdapterType(input.adapterType)) {
    return [];
  }

  const adapterType: SupportedAdapterType = input.adapterType;
  const nativeHomeHostPath = resolveNativeHomeHostPath({
    adapterType,
    executionWorkspaceCwd: input.executionWorkspaceCwd,
    executionConfig: input.executionConfig,
  });
  const files = await resolveHermesNativeMemoryFiles({
    companyId: input.companyId,
    agentId: input.agentId,
    nativeHomeHostPath,
  });
  if (files.length === 0) {
    return [];
  }

  const existingRows = await db
    .select()
    .from(sharedContextPublications)
    .where(
      and(
        eq(sharedContextPublications.companyId, input.companyId),
        eq(sharedContextPublications.sourceAgentId, input.agentId),
      ),
    );

  const imported: ImportedNativeMemoryRecord[] = [];
  for (const file of files) {
    await fs.mkdir(path.dirname(file.snapshotPath), { recursive: true });
    await fs.writeFile(file.snapshotPath, `${file.body}\n`, "utf8");

    const provenance = {
      type: "native_memory_import",
      adapterType,
      kind: file.kind,
      sourcePath: file.sourcePath,
      snapshotPath: file.snapshotPath,
      importedByRunId: input.runId,
    } satisfies Record<string, unknown>;

    const existing = existingRows.find((row) => matchesImportedNativeMemory(row, {
      adapterType,
      kind: file.kind,
      sourcePath: file.sourcePath,
    })) ?? null;

    if (!existing) {
      const updatedAt = new Date();
      const [created] = await db
        .insert(sharedContextPublications)
        .values({
          companyId: input.companyId,
          projectId: null,
          issueId: null,
          sourceAgentId: input.agentId,
          createdByRunId: input.runId,
          title: file.title,
          summary: file.summary,
          body: file.body,
          tags: file.tags,
          visibility: "company",
          audienceAgentIds: [],
          status: "published",
          freshness: "recent",
          freshnessAt: updatedAt,
          confidence: null,
          rank: 80,
          provenance,
          updatedAt,
        })
        .returning();
      imported.push({
        id: created.id,
        kind: file.kind,
        title: file.title,
        sourcePath: file.sourcePath,
        snapshotPath: file.snapshotPath,
        updatedAt,
      });
      continue;
    }

    const existingProvenance = parseObject(existing.provenance);
    const snapshotChanged = existingProvenance.snapshotPath !== file.snapshotPath;
    if (
      existing.body === file.body
      && existing.title === file.title
      && (existing.summary ?? null) === file.summary
      && JSON.stringify(existing.tags ?? []) === JSON.stringify(file.tags)
      && snapshotChanged === false
    ) {
      continue;
    }

    const updatedAt = new Date();
    const [updated] = await db
      .update(sharedContextPublications)
      .set({
        title: file.title,
        summary: file.summary,
        body: file.body,
        tags: file.tags,
        freshness: "recent",
        freshnessAt: updatedAt,
        provenance,
        updatedAt,
      })
      .where(eq(sharedContextPublications.id, existing.id))
      .returning();
    imported.push({
      id: updated.id,
      kind: file.kind,
      title: file.title,
      sourcePath: file.sourcePath,
      snapshotPath: file.snapshotPath,
      updatedAt,
    });
  }

  return imported;
}

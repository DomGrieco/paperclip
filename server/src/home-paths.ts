import os from "node:os";
import path from "node:path";

const DEFAULT_INSTANCE_ID = "default";
const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;
const FRIENDLY_PATH_SEGMENT_RE = /[^a-zA-Z0-9._-]+/g;

function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolvePaperclipHomeDir(): string {
  const envHome = process.env.PAPERCLIP_HOME?.trim();
  if (envHome) return path.resolve(expandHomePrefix(envHome));
  return path.resolve(os.homedir(), ".paperclip");
}

export function resolvePaperclipInstanceId(): string {
  const raw = process.env.PAPERCLIP_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(`Invalid PAPERCLIP_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolvePaperclipInstanceRoot(): string {
  return path.resolve(resolvePaperclipHomeDir(), "instances", resolvePaperclipInstanceId());
}

export function resolveDefaultConfigPath(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "config.json");
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "db");
}

export function resolveDefaultLogsDir(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "logs");
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "secrets", "master.key");
}

export function resolveDefaultStorageDir(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "data", "storage");
}

export function resolveDefaultBackupDir(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "data", "backups");
}

export function resolveDefaultAgentWorkspaceDir(agentId: string): string {
  const trimmed = agentId.trim();
  if (!PATH_SEGMENT_RE.test(trimmed)) {
    throw new Error(`Invalid agent id for workspace path '${agentId}'.`);
  }
  return path.resolve(resolvePaperclipInstanceRoot(), "workspaces", trimmed);
}

function requireFriendlyPathSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} path requires ${label}.`);
  }
  return sanitizeFriendlyPathSegment(trimmed, label);
}

function resolveCompanyRoot(companyId: string): string {
  const trimmed = companyId.trim();
  if (!trimmed) {
    throw new Error("Company shared runtime path requires companyId.");
  }
  return path.resolve(
    resolvePaperclipInstanceRoot(),
    "companies",
    sanitizeFriendlyPathSegment(trimmed, "company"),
  );
}

export function resolveCompanySharedRuntimeRoot(companyId: string): string {
  return path.resolve(resolveCompanyRoot(companyId), "shared");
}

export function resolveCompanySharedSkillsRoot(companyId: string): string {
  return path.resolve(resolveCompanySharedRuntimeRoot(companyId), "managed-skills");
}

export function resolveCompanySharedContextRoot(companyId: string): string {
  return path.resolve(resolveCompanySharedRuntimeRoot(companyId), "context");
}

export function resolveCompanySharedMemoryRoot(companyId: string): string {
  return path.resolve(resolveCompanySharedRuntimeRoot(companyId), "memory");
}

export function resolveCompanySharedArtifactsRoot(companyId: string): string {
  return path.resolve(resolveCompanySharedRuntimeRoot(companyId), "artifacts");
}

export function resolveAgentRuntimeHomeRoot(companyId: string, agentId: string, adapterType: string): string {
  const trimmedCompanyId = companyId.trim();
  const trimmedAgentId = agentId.trim();
  if (!trimmedCompanyId || !trimmedAgentId) {
    throw new Error("Agent runtime home path requires companyId and agentId.");
  }
  const normalizedAdapterType = requireFriendlyPathSegment(adapterType, "adapterType");
  return path.resolve(
    resolveCompanyRoot(trimmedCompanyId),
    "agents",
    sanitizeFriendlyPathSegment(trimmedAgentId, "agent"),
    "homes",
    normalizedAdapterType,
  );
}

export function resolveAdapterRuntimeCacheRoot(adapterType: string): string {
  const normalizedAdapterType = requireFriendlyPathSegment(adapterType, "adapterType");
  return path.resolve(resolvePaperclipInstanceRoot(), "runtime-cache", normalizedAdapterType);
}

export function resolveAdapterRuntimeChannelRoot(adapterType: string, channel: string): string {
  const normalizedChannel = sanitizeFriendlyPathSegment(channel, "stable");
  return path.resolve(resolveAdapterRuntimeCacheRoot(adapterType), "channels", normalizedChannel);
}

export function resolveAdapterRuntimeChannelMetadataPath(adapterType: string, channel: string): string {
  return path.resolve(resolveAdapterRuntimeChannelRoot(adapterType, channel), "metadata.json");
}

export function resolveCompanyHermesHomeDir(companyId: string): string {
  const trimmed = companyId.trim();
  if (!trimmed) {
    throw new Error("Managed Hermes home path requires companyId.");
  }
  return path.resolve(
    resolveCompanyRoot(trimmed),
    "hermes-home",
  );
}

export function resolveHermesRuntimeCacheRoot(): string {
  return resolveAdapterRuntimeCacheRoot("hermes");
}

export function resolveHermesRuntimeChannelRoot(channel: string): string {
  return resolveAdapterRuntimeChannelRoot("hermes", channel);
}

export function resolveHermesRuntimeChannelMetadataPath(channel: string): string {
  return resolveAdapterRuntimeChannelMetadataPath("hermes", channel);
}

function sanitizeFriendlyPathSegment(value: string | null | undefined, fallback = "_default"): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return fallback;
  const sanitized = trimmed
    .replace(FRIENDLY_PATH_SEGMENT_RE, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

export function resolveManagedProjectWorkspaceDir(input: {
  companyId: string;
  projectId: string;
  repoName?: string | null;
}): string {
  const companyId = input.companyId.trim();
  const projectId = input.projectId.trim();
  if (!companyId || !projectId) {
    throw new Error("Managed project workspace path requires companyId and projectId.");
  }
  return path.resolve(
    resolvePaperclipInstanceRoot(),
    "projects",
    sanitizeFriendlyPathSegment(companyId, "company"),
    sanitizeFriendlyPathSegment(projectId, "project"),
    sanitizeFriendlyPathSegment(input.repoName, "_default"),
  );
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}

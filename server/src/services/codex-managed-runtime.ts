import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureManagedAgentRuntime,
  type AgentManagedRuntimeInstallResult,
  type AgentManagedRuntimeProfile,
  type AgentManagedRuntimeResolution,
  type AgentManagedRuntimeSettings,
  type RunCommand,
} from "./agent-managed-runtime.js";
import {
  resolveAdapterRuntimeChannelMetadataPath,
  resolveAdapterRuntimeChannelRoot,
} from "../home-paths.js";

const DEFAULT_CHANNEL = "stable";
const DEFAULT_SOURCE = "@openai/codex@latest";
const DEFAULT_REFRESH_INTERVAL_MINUTES = 360;
const ADAPTER_TYPE = "codex_local";

export interface CodexManagedRuntimeResolution {
  schemaVersion: "v1";
  channel: string;
  source: string;
  installRoot: string;
  commandPath: string;
  version: string;
  checkedAt: string;
  updatedAt: string;
  refreshIntervalMinutes: number;
  refreshed: boolean;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function readPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeChannel(rawChannel: string | null): string {
  const normalized = rawChannel?.trim().toLowerCase() ?? DEFAULT_CHANNEL;
  const safe = normalized.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || DEFAULT_CHANNEL;
}

function resolveSettings(config: Record<string, unknown>): AgentManagedRuntimeSettings {
  const explicit =
    typeof config.managedRuntime === "object" && config.managedRuntime !== null
      ? (config.managedRuntime as Record<string, unknown>)
      : {};

  const enabled =
    readBoolean(explicit.autoUpdate) ??
    readBoolean(config.codexManagedRuntimeAutoUpdate) ??
    readBoolean(process.env.PAPERCLIP_CODEX_MANAGED_RUNTIME_AUTO_UPDATE) ??
    true;

  const channel = sanitizeChannel(
    readString(explicit.channel) ??
      readString(config.codexManagedRuntimeChannel) ??
      readString(process.env.PAPERCLIP_CODEX_MANAGED_RUNTIME_CHANNEL),
  );

  const source =
    readString(explicit.source) ??
    readString(config.codexManagedRuntimeSource) ??
    readString(process.env.PAPERCLIP_CODEX_MANAGED_RUNTIME_SOURCE) ??
    DEFAULT_SOURCE;

  const refreshIntervalMinutes =
    readPositiveNumber(explicit.refreshIntervalMinutes) ??
    readPositiveNumber(config.codexManagedRuntimeRefreshIntervalMinutes) ??
    readPositiveNumber(process.env.PAPERCLIP_CODEX_MANAGED_RUNTIME_REFRESH_INTERVAL_MINUTES) ??
    DEFAULT_REFRESH_INTERVAL_MINUTES;

  return {
    enabled,
    channel,
    source,
    refreshIntervalMinutes,
  };
}

function parseVersion(stdout: string, stderr: string): string {
  const merged = `${stdout}\n${stderr}`.trim();
  return merged.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "unknown";
}

async function installManagedRuntime(input: {
  channelRoot: string;
  settings: AgentManagedRuntimeSettings;
  now: Date;
  runCommand: RunCommand;
}): Promise<AgentManagedRuntimeInstallResult> {
  const installsRoot = path.join(input.channelRoot, "installs");
  await fs.mkdir(installsRoot, { recursive: true });

  const stamp = input.now.toISOString().replace(/[:.]/g, "-");
  const installRoot = path.join(installsRoot, stamp);
  const commandPath = path.join(installRoot, "bin", "codex");

  await fs.rm(installRoot, { recursive: true, force: true });
  await input.runCommand({
    command: "npm",
    args: ["install", "--global", "--prefix", installRoot, "--omit=dev", input.settings.source],
  });
  const versionResult = await input.runCommand({ command: commandPath, args: ["--version"] });
  const version = parseVersion(versionResult.stdout, versionResult.stderr);

  return {
    installRoot,
    commandPath,
    version,
  };
}

const codexManagedRuntimeProfile: AgentManagedRuntimeProfile = {
  adapterType: ADAPTER_TYPE,
  provider: "managed_runtime_cache",
  resolveSettings,
  resolveChannelRoot: (channel) => resolveAdapterRuntimeChannelRoot(ADAPTER_TYPE, channel),
  resolveMetadataPath: (channel, channelRoot) =>
    channelRoot ? path.join(channelRoot, "metadata.json") : resolveAdapterRuntimeChannelMetadataPath(ADAPTER_TYPE, channel),
  installRuntime: installManagedRuntime,
};

function toCodexManagedRuntimeResolution(info: AgentManagedRuntimeResolution): CodexManagedRuntimeResolution {
  return {
    schemaVersion: "v1",
    channel: info.channel,
    source: info.source,
    installRoot: info.installRoot,
    commandPath: info.commandPath,
    version: info.version,
    checkedAt: info.checkedAt,
    updatedAt: info.updatedAt,
    refreshIntervalMinutes: info.refreshIntervalMinutes,
    refreshed: info.refreshed,
  };
}

export async function ensureManagedCodexRuntime(input: {
  config?: Record<string, unknown>;
  now?: Date;
  runCommand?: RunCommand;
  channelRoot?: string;
} = {}): Promise<CodexManagedRuntimeResolution> {
  const result = await ensureManagedAgentRuntime({
    profile: codexManagedRuntimeProfile,
    config: input.config,
    now: input.now,
    runCommand: input.runCommand,
    channelRoot: input.channelRoot,
  });
  return toCodexManagedRuntimeResolution(result);
}

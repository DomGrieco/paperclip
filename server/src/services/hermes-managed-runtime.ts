import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureManagedAgentRuntime,
  type AgentManagedRuntimeInfo,
  type AgentManagedRuntimeInstallResult,
  type AgentManagedRuntimeProfile,
  type AgentManagedRuntimeSettings,
  type AgentManagedRuntimeResolution,
  type RunCommand,
} from "./agent-managed-runtime.js";
import {
  resolveHermesRuntimeChannelRoot,
  resolveHermesRuntimeChannelMetadataPath,
} from "../home-paths.js";

const DEFAULT_CHANNEL = "stable";
const DEFAULT_SOURCE = "git+https://github.com/NousResearch/hermes-agent.git";
const DEFAULT_REFRESH_INTERVAL_MINUTES = 360;

export interface HermesManagedRuntimeInfo {
  schemaVersion: "v1";
  channel: string;
  source: string;
  installRoot: string;
  hermesCommand: string;
  pythonCommand: string;
  version: string;
  checkedAt: string;
  updatedAt: string;
  refreshIntervalMinutes: number;
}

export interface HermesManagedRuntimeResolution extends HermesManagedRuntimeInfo {
  refreshed: boolean;
}

type HermesManagedRuntimeSettings = AgentManagedRuntimeSettings;

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

function resolveSettings(config: Record<string, unknown>): HermesManagedRuntimeSettings {
  const explicit =
    typeof config.managedRuntime === "object" && config.managedRuntime !== null
      ? (config.managedRuntime as Record<string, unknown>)
      : {};

  const enabled =
    readBoolean(explicit.autoUpdate) ??
    readBoolean(config.hermesManagedRuntimeAutoUpdate) ??
    readBoolean(process.env.PAPERCLIP_HERMES_MANAGED_RUNTIME_AUTO_UPDATE) ??
    true;

  const channel = sanitizeChannel(
    readString(explicit.channel) ??
      readString(config.hermesManagedRuntimeChannel) ??
      readString(process.env.PAPERCLIP_HERMES_MANAGED_RUNTIME_CHANNEL),
  );

  const source =
    readString(explicit.source) ??
    readString(config.hermesManagedRuntimeSource) ??
    readString(process.env.PAPERCLIP_HERMES_MANAGED_RUNTIME_SOURCE) ??
    DEFAULT_SOURCE;

  const refreshIntervalMinutes =
    readPositiveNumber(explicit.refreshIntervalMinutes) ??
    readPositiveNumber(config.hermesManagedRuntimeRefreshIntervalMinutes) ??
    readPositiveNumber(process.env.PAPERCLIP_HERMES_MANAGED_RUNTIME_REFRESH_INTERVAL_MINUTES) ??
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

function readLegacyHermesMetadata(value: unknown): AgentManagedRuntimeInfo | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Record<string, unknown>;
  if (
    parsed.schemaVersion !== "v1" ||
    typeof parsed.channel !== "string" ||
    typeof parsed.source !== "string" ||
    typeof parsed.installRoot !== "string" ||
    typeof parsed.hermesCommand !== "string" ||
    typeof parsed.pythonCommand !== "string" ||
    typeof parsed.version !== "string" ||
    typeof parsed.checkedAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    typeof parsed.refreshIntervalMinutes !== "number"
  ) {
    return null;
  }

  return {
    ...parsed,
    adapterType: "hermes",
    provider: "managed_runtime_cache",
    commandPath: parsed.hermesCommand,
  } as AgentManagedRuntimeInfo;
}

async function installManagedRuntime(input: {
  channelRoot: string;
  settings: HermesManagedRuntimeSettings;
  now: Date;
  runCommand: RunCommand;
}): Promise<AgentManagedRuntimeInstallResult> {
  const installsRoot = path.join(input.channelRoot, "installs");
  await fs.mkdir(installsRoot, { recursive: true });

  const stamp = input.now.toISOString().replace(/[:.]/g, "-");
  const finalRoot = path.join(installsRoot, stamp);
  const venvRoot = path.join(finalRoot, "venv");
  const pythonCommand = path.join(venvRoot, "bin", "python");
  const hermesCommand = path.join(venvRoot, "bin", "hermes");

  await fs.rm(finalRoot, { recursive: true, force: true });
  await input.runCommand({ command: "python3", args: ["-m", "venv", venvRoot] });
  await input.runCommand({ command: pythonCommand, args: ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"] });
  await input.runCommand({ command: pythonCommand, args: ["-m", "pip", "install", "--upgrade", input.settings.source] });
  const versionResult = await input.runCommand({ command: hermesCommand, args: ["--version"] });
  const version = parseVersion(versionResult.stdout, versionResult.stderr);

  return {
    installRoot: finalRoot,
    commandPath: hermesCommand,
    version,
    extraFields: {
      pythonCommand,
      hermesCommand,
    },
  };
}

const hermesManagedRuntimeProfile: AgentManagedRuntimeProfile = {
  adapterType: "hermes",
  provider: "managed_runtime_cache",
  resolveSettings,
  resolveChannelRoot: (channel) => resolveHermesRuntimeChannelRoot(channel),
  resolveMetadataPath: (channel, channelRoot) =>
    channelRoot ? path.join(channelRoot, "metadata.json") : resolveHermesRuntimeChannelMetadataPath(channel),
  installRuntime: installManagedRuntime,
  deserializeMetadata: readLegacyHermesMetadata,
};

function toHermesManagedRuntimeResolution(info: AgentManagedRuntimeResolution): HermesManagedRuntimeResolution {
  const hermesCommand = readString(info.hermesCommand) ?? info.commandPath;
  const pythonCommand = readString(info.pythonCommand) ?? path.join(info.installRoot, "venv", "bin", "python");
  return {
    schemaVersion: "v1",
    channel: info.channel,
    source: info.source,
    installRoot: info.installRoot,
    hermesCommand,
    pythonCommand,
    version: info.version,
    checkedAt: info.checkedAt,
    updatedAt: info.updatedAt,
    refreshIntervalMinutes: info.refreshIntervalMinutes,
    refreshed: info.refreshed,
  };
}

export async function ensureManagedHermesRuntime(input: {
  config?: Record<string, unknown>;
  now?: Date;
  runCommand?: RunCommand;
  channelRoot?: string;
} = {}): Promise<HermesManagedRuntimeResolution> {
  const result = await ensureManagedAgentRuntime({
    profile: hermesManagedRuntimeProfile,
    config: input.config,
    now: input.now,
    runCommand: input.runCommand,
    channelRoot: input.channelRoot,
  });
  return toHermesManagedRuntimeResolution(result);
}

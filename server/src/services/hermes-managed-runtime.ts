import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  resolveHermesRuntimeChannelRoot,
  resolveHermesRuntimeChannelMetadataPath,
} from "../home-paths.js";

const execFileAsync = promisify(execFile);
const DEFAULT_CHANNEL = "stable";
const DEFAULT_SOURCE = "git+https://github.com/NousResearch/hermes-agent.git";
const DEFAULT_REFRESH_INTERVAL_MINUTES = 360;
const LOCK_RETRY_DELAY_MS = 250;
const LOCK_TIMEOUT_MS = 30_000;

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

type HermesManagedRuntimeSettings = {
  enabled: boolean;
  channel: string;
  source: string;
  refreshIntervalMinutes: number;
};

type RunCommandInput = {
  command: string;
  args: string[];
  cwd?: string;
};

type RunCommandResult = {
  stdout: string;
  stderr: string;
};

type RunCommand = (input: RunCommandInput) => Promise<RunCommandResult>;

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

function nowIso(now: Date): string {
  return now.toISOString();
}

function isStale(info: HermesManagedRuntimeInfo, now: Date): boolean {
  const anchor = Date.parse(info.checkedAt || info.updatedAt);
  if (!Number.isFinite(anchor)) return true;
  const maxAgeMs = info.refreshIntervalMinutes * 60_000;
  return anchor + maxAgeMs <= now.getTime();
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function readMetadata(metadataPath: string): Promise<HermesManagedRuntimeInfo | null> {
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<HermesManagedRuntimeInfo>;
    if (
      parsed.schemaVersion !== "v1" ||
      !parsed.installRoot ||
      !parsed.hermesCommand ||
      !parsed.pythonCommand ||
      !parsed.version ||
      !parsed.channel ||
      !parsed.source ||
      !parsed.updatedAt ||
      !parsed.checkedAt ||
      typeof parsed.refreshIntervalMinutes !== "number"
    ) {
      return null;
    }
    return parsed as HermesManagedRuntimeInfo;
  } catch {
    return null;
  }
}

async function writeMetadata(metadataPath: string, info: HermesManagedRuntimeInfo): Promise<void> {
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  const tempPath = `${metadataPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tempPath, `${JSON.stringify(info, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, metadataPath);
}

async function defaultRunCommand(input: RunCommandInput): Promise<RunCommandResult> {
  const result = await execFileAsync(input.command, input.args, {
    cwd: input.cwd,
    maxBuffer: 1024 * 1024 * 16,
    timeout: 1000 * 60 * 10,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseVersion(stdout: string, stderr: string): string {
  const merged = `${stdout}\n${stderr}`.trim();
  return merged.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "unknown";
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const startedAt = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockPath, { recursive: false });
      return async () => {
        await fs.rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
      if (code !== "EEXIST") throw error;
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for Hermes managed runtime lock at ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }
}

async function installManagedRuntime(input: {
  channelRoot: string;
  settings: HermesManagedRuntimeSettings;
  now: Date;
  runCommand: RunCommand;
}): Promise<HermesManagedRuntimeInfo> {
  const installsRoot = path.join(input.channelRoot, "installs");
  await fs.mkdir(installsRoot, { recursive: true });

  const stamp = input.now.toISOString().replace(/[:.]/g, "-");
  const finalRoot = path.join(installsRoot, stamp);
  const tempRoot = `${finalRoot}.tmp-${Math.random().toString(36).slice(2, 8)}`;
  const venvRoot = path.join(tempRoot, "venv");
  const pythonCommand = path.join(venvRoot, "bin", "python");
  const hermesCommand = path.join(venvRoot, "bin", "hermes");

  await fs.rm(tempRoot, { recursive: true, force: true });
  await input.runCommand({ command: "python3", args: ["-m", "venv", venvRoot] });
  await input.runCommand({ command: pythonCommand, args: ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"] });
  await input.runCommand({ command: pythonCommand, args: ["-m", "pip", "install", "--upgrade", input.settings.source] });
  const versionResult = await input.runCommand({ command: hermesCommand, args: ["--version"] });
  const version = parseVersion(versionResult.stdout, versionResult.stderr);

  await fs.rename(tempRoot, finalRoot);
  return {
    schemaVersion: "v1",
    channel: input.settings.channel,
    source: input.settings.source,
    installRoot: finalRoot,
    hermesCommand: path.join(finalRoot, "venv", "bin", "hermes"),
    pythonCommand: path.join(finalRoot, "venv", "bin", "python"),
    version,
    checkedAt: nowIso(input.now),
    updatedAt: nowIso(input.now),
    refreshIntervalMinutes: input.settings.refreshIntervalMinutes,
  };
}

export async function ensureManagedHermesRuntime(input: {
  config?: Record<string, unknown>;
  now?: Date;
  runCommand?: RunCommand;
  channelRoot?: string;
} = {}): Promise<HermesManagedRuntimeResolution> {
  const config = input.config ?? {};
  const settings = resolveSettings(config);
  const now = input.now ?? new Date();
  const channelRoot = input.channelRoot ?? resolveHermesRuntimeChannelRoot(settings.channel);
  const metadataPath = input.channelRoot
    ? path.join(channelRoot, "metadata.json")
    : resolveHermesRuntimeChannelMetadataPath(settings.channel);
  const lockPath = path.join(channelRoot, ".lock");
  const runCommand = input.runCommand ?? defaultRunCommand;

  await fs.mkdir(channelRoot, { recursive: true });
  const releaseLock = await acquireLock(lockPath);
  try {
    const existing = await readMetadata(metadataPath);
    if (
      existing &&
      existing.channel === settings.channel &&
      existing.source === settings.source &&
      (await pathExists(existing.hermesCommand)) &&
      (!settings.enabled || !isStale(existing, now))
    ) {
      const nextInfo: HermesManagedRuntimeInfo = {
        ...existing,
        checkedAt: nowIso(now),
        refreshIntervalMinutes: settings.refreshIntervalMinutes,
      };
      await writeMetadata(metadataPath, nextInfo);
      return { ...nextInfo, refreshed: false };
    }

    const installed = await installManagedRuntime({
      channelRoot,
      settings,
      now,
      runCommand,
    });
    await writeMetadata(metadataPath, installed);
    return { ...installed, refreshed: true };
  } finally {
    await releaseLock();
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LOCK_RETRY_DELAY_MS = 250;
const LOCK_TIMEOUT_MS = 30_000;

export interface AgentManagedRuntimeInfo {
  schemaVersion: "v1";
  adapterType: string;
  provider: string;
  channel: string;
  source: string;
  installRoot: string;
  commandPath: string;
  version: string;
  checkedAt: string;
  updatedAt: string;
  refreshIntervalMinutes: number;
  [key: string]: unknown;
}

export interface AgentManagedRuntimeResolution extends AgentManagedRuntimeInfo {
  refreshed: boolean;
}

export type AgentManagedRuntimeSettings = {
  enabled: boolean;
  channel: string;
  source: string;
  refreshIntervalMinutes: number;
};

export type RunCommandInput = {
  command: string;
  args: string[];
  cwd?: string;
};

export type RunCommandResult = {
  stdout: string;
  stderr: string;
};

export type RunCommand = (input: RunCommandInput) => Promise<RunCommandResult>;

export type AgentManagedRuntimeInstallResult = {
  installRoot: string;
  commandPath: string;
  version: string;
  extraFields?: Record<string, unknown>;
};

export interface AgentManagedRuntimeProfile {
  adapterType: string;
  provider: string;
  resolveSettings(config: Record<string, unknown>): AgentManagedRuntimeSettings;
  resolveChannelRoot(channel: string): string;
  resolveMetadataPath(channel: string, channelRoot?: string): string;
  installRuntime(input: {
    channelRoot: string;
    settings: AgentManagedRuntimeSettings;
    now: Date;
    runCommand: RunCommand;
  }): Promise<AgentManagedRuntimeInstallResult>;
  deserializeMetadata?(value: unknown): AgentManagedRuntimeInfo | null;
  isRuntimeFunctional?(info: AgentManagedRuntimeInfo, runCommand: RunCommand): Promise<boolean>;
}

function nowIso(now: Date): string {
  return now.toISOString();
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseBaseMetadata(value: unknown): AgentManagedRuntimeInfo | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Record<string, unknown>;
  if (
    parsed.schemaVersion !== "v1" ||
    typeof parsed.adapterType !== "string" ||
    typeof parsed.provider !== "string" ||
    typeof parsed.channel !== "string" ||
    typeof parsed.source !== "string" ||
    typeof parsed.installRoot !== "string" ||
    typeof parsed.commandPath !== "string" ||
    typeof parsed.version !== "string" ||
    typeof parsed.checkedAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    !isPositiveNumber(parsed.refreshIntervalMinutes)
  ) {
    return null;
  }
  return parsed as AgentManagedRuntimeInfo;
}

function isStale(info: AgentManagedRuntimeInfo, now: Date): boolean {
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

async function readMetadata(profile: AgentManagedRuntimeProfile, metadataPath: string): Promise<AgentManagedRuntimeInfo | null> {
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return profile.deserializeMetadata?.(parsed) ?? parseBaseMetadata(parsed);
  } catch {
    return null;
  }
}

async function writeMetadata(metadataPath: string, info: AgentManagedRuntimeInfo): Promise<void> {
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

async function defaultRuntimeFunctionalCheck(info: AgentManagedRuntimeInfo, runCommand: RunCommand): Promise<boolean> {
  try {
    await runCommand({ command: info.commandPath, args: ["--version"] });
    return true;
  } catch {
    return false;
  }
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
        throw new Error(`Timed out waiting for managed runtime lock at ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }
}

export async function ensureManagedAgentRuntime(input: {
  profile: AgentManagedRuntimeProfile;
  config?: Record<string, unknown>;
  now?: Date;
  runCommand?: RunCommand;
  channelRoot?: string;
}): Promise<AgentManagedRuntimeResolution> {
  const profile = input.profile;
  const config = input.config ?? {};
  const settings = profile.resolveSettings(config);
  const now = input.now ?? new Date();
  const channelRoot = input.channelRoot ?? profile.resolveChannelRoot(settings.channel);
  const metadataPath = profile.resolveMetadataPath(settings.channel, input.channelRoot ? channelRoot : undefined);
  const runCommand = input.runCommand ?? defaultRunCommand;
  const isFunctional = profile.isRuntimeFunctional ?? defaultRuntimeFunctionalCheck;
  const lockPath = path.join(channelRoot, ".lock");

  await fs.mkdir(channelRoot, { recursive: true });
  const releaseLock = await acquireLock(lockPath);
  try {
    const existing = await readMetadata(profile, metadataPath);
    if (
      existing &&
      existing.adapterType === profile.adapterType &&
      existing.provider === profile.provider &&
      existing.channel === settings.channel &&
      existing.source === settings.source &&
      (await pathExists(existing.commandPath)) &&
      (await isFunctional(existing, runCommand)) &&
      (!settings.enabled || !isStale(existing, now))
    ) {
      const nextInfo: AgentManagedRuntimeInfo = {
        ...existing,
        checkedAt: nowIso(now),
        refreshIntervalMinutes: settings.refreshIntervalMinutes,
      };
      await writeMetadata(metadataPath, nextInfo);
      return { ...nextInfo, refreshed: false };
    }

    const installed = await profile.installRuntime({
      channelRoot,
      settings,
      now,
      runCommand,
    });
    const nextInfo: AgentManagedRuntimeInfo = {
      schemaVersion: "v1",
      adapterType: profile.adapterType,
      provider: profile.provider,
      channel: settings.channel,
      source: settings.source,
      installRoot: installed.installRoot,
      commandPath: installed.commandPath,
      version: installed.version,
      checkedAt: nowIso(now),
      updatedAt: nowIso(now),
      refreshIntervalMinutes: settings.refreshIntervalMinutes,
      ...(installed.extraFields ?? {}),
    };
    await writeMetadata(metadataPath, nextInfo);
    return { ...nextInfo, refreshed: true };
  } finally {
    await releaseLock();
  }
}

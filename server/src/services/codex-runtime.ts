import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentContainerLaunchPlan } from "@paperclipai/shared";
import { ensureManagedCodexRuntime, type CodexManagedRuntimeResolution } from "./codex-managed-runtime.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const containerExecScriptPath = path.resolve(moduleDir, "..", "..", "scripts", "agent-container-exec.js");
const DEFAULT_SHARED_CODEX_HOME_SOURCE = "/paperclip/shared/codex-home-source";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseEnv(config: Record<string, unknown>): Record<string, string> {
  const raw =
    typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"),
  );
}

function planEnvToRecord(plan: AgentContainerLaunchPlan): Record<string, string> {
  return Object.fromEntries(plan.env.map((entry) => [entry.name, entry.value]));
}

export async function prepareCodexAdapterConfigForExecution(input: {
  config: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const nextConfig: Record<string, unknown> = { ...input.config };
  const env = parseEnv(input.config);
  const explicitCommand = readString(input.config.command);
  const managedRuntime = explicitCommand
    ? null
    : await ensureManagedCodexRuntime({ config: input.config });

  if (managedRuntime) {
    nextConfig.command = managedRuntime.commandPath;
    env.PAPERCLIP_CODEX_MANAGED_RUNTIME_ROOT = managedRuntime.installRoot;
    env.PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND = managedRuntime.commandPath;
    env.PAPERCLIP_CODEX_MANAGED_RUNTIME_VERSION = managedRuntime.version;
    env.PAPERCLIP_CODEX_MANAGED_RUNTIME_CHANNEL = managedRuntime.channel;
    env.PAPERCLIP_CODEX_MANAGED_RUNTIME_SOURCE = managedRuntime.source;
    env.PAPERCLIP_CODEX_MANAGED_RUNTIME_UPDATED_AT = managedRuntime.updatedAt;
    env.PAPERCLIP_CODEX_MANAGED_RUNTIME_CHECKED_AT = managedRuntime.checkedAt;
    env.PAPERCLIP_CODEX_MANAGED_RUNTIME_REFRESHED = managedRuntime.refreshed ? "true" : "false";
  }

  env.PAPERCLIP_CODEX_SHARED_HOME_SOURCE = readString(env.PAPERCLIP_CODEX_SHARED_HOME_SOURCE)
    ?? DEFAULT_SHARED_CODEX_HOME_SOURCE;

  nextConfig.env = env;
  return nextConfig;
}

export function injectCodexContainerExecConfig(input: {
  config: Record<string, unknown>;
  plan: AgentContainerLaunchPlan | null;
  containerId: string | null;
}): Record<string, unknown> {
  if (!input.plan || !input.containerId) return input.config;

  const nextConfig: Record<string, unknown> = {
    ...input.config,
    command: containerExecScriptPath,
  };
  const env = parseEnv(input.config);
  const planEnv = planEnvToRecord(input.plan);
  env.PAPERCLIP_AGENT_CONTAINER_ID = input.containerId;
  env.PAPERCLIP_AGENT_CONTAINER_COMMAND = input.plan.command[0] ?? "codex";
  env.PAPERCLIP_AGENT_CONTAINER_WORKDIR = input.plan.workingDir;
  env.PAPERCLIP_AGENT_CONTAINER_EXEC_ENV_JSON = JSON.stringify(planEnv);
  nextConfig.env = env;
  return nextConfig;
}

export function getManagedCodexRuntimeFromEnv(config: Record<string, unknown>): CodexManagedRuntimeResolution | null {
  const env = parseEnv(config);
  const installRoot = readString(env.PAPERCLIP_CODEX_MANAGED_RUNTIME_ROOT);
  const commandPath = readString(env.PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND);
  const version = readString(env.PAPERCLIP_CODEX_MANAGED_RUNTIME_VERSION);
  const channel = readString(env.PAPERCLIP_CODEX_MANAGED_RUNTIME_CHANNEL);
  const source = readString(env.PAPERCLIP_CODEX_MANAGED_RUNTIME_SOURCE);
  const checkedAt = readString(env.PAPERCLIP_CODEX_MANAGED_RUNTIME_CHECKED_AT);
  const updatedAt = readString(env.PAPERCLIP_CODEX_MANAGED_RUNTIME_UPDATED_AT);
  if (!installRoot || !commandPath || !version || !channel || !source || !checkedAt || !updatedAt) {
    return null;
  }
  return {
    schemaVersion: "v1",
    installRoot,
    commandPath,
    version,
    channel,
    source,
    checkedAt,
    updatedAt,
    refreshIntervalMinutes: Number(env.PAPERCLIP_CODEX_MANAGED_RUNTIME_REFRESH_INTERVAL_MINUTES ?? 360),
    refreshed: env.PAPERCLIP_CODEX_MANAGED_RUNTIME_REFRESHED === "true",
  };
}

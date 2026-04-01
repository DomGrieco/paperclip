import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentContainerLaunchPlan } from "@paperclipai/shared";
import { ensureManagedCursorRuntime } from "./cursor-managed-runtime.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const containerExecScriptPath = path.resolve(moduleDir, "..", "..", "scripts", "agent-container-exec.js");

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

export async function prepareCursorAdapterConfigForExecution(input: {
  config: Record<string, unknown>;
  cwd: string;
}): Promise<Record<string, unknown>> {
  const nextConfig: Record<string, unknown> = { ...input.config };
  const env = parseEnv(input.config);
  env.HOME = readString(env.HOME) ?? path.join(input.cwd, ".paperclip", "cursor-home");
  const explicitCommand = readString(input.config.command);
  const managedRuntime = explicitCommand
    ? null
    : await ensureManagedCursorRuntime({ config: input.config });

  if (managedRuntime) {
    nextConfig.command = managedRuntime.commandPath;
    env.PAPERCLIP_CURSOR_MANAGED_RUNTIME_ROOT = managedRuntime.installRoot;
    env.PAPERCLIP_CURSOR_MANAGED_RUNTIME_COMMAND = managedRuntime.commandPath;
    env.PAPERCLIP_CURSOR_MANAGED_RUNTIME_VERSION = managedRuntime.version;
    env.PAPERCLIP_CURSOR_MANAGED_RUNTIME_CHANNEL = managedRuntime.channel;
    env.PAPERCLIP_CURSOR_MANAGED_RUNTIME_SOURCE = managedRuntime.source;
    env.PAPERCLIP_CURSOR_MANAGED_RUNTIME_UPDATED_AT = managedRuntime.updatedAt;
    env.PAPERCLIP_CURSOR_MANAGED_RUNTIME_CHECKED_AT = managedRuntime.checkedAt;
    env.PAPERCLIP_CURSOR_MANAGED_RUNTIME_REFRESHED = managedRuntime.refreshed ? "true" : "false";
  }

  nextConfig.env = env;
  return nextConfig;
}

export function injectCursorContainerExecConfig(input: {
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
  env.PAPERCLIP_AGENT_CONTAINER_COMMAND = input.plan.command[0] ?? "agent";
  env.PAPERCLIP_AGENT_CONTAINER_WORKDIR = input.plan.workingDir;
  env.PAPERCLIP_AGENT_CONTAINER_EXEC_ENV_JSON = JSON.stringify(planEnv);
  nextConfig.env = env;
  return nextConfig;
}

import path from "node:path";
import type { AgentContainerEnvPlan, AgentContainerLaunchPlan, RuntimeBundle, RuntimeBundleRunner } from "@paperclipai/shared";
import { parseObject } from "../adapters/utils.js";
import {
  AGENT_CONTAINER_SHARED_CONTEXT_PATH,
  AGENT_CONTAINER_WORKSPACE_PATH,
  getAgentContainerProfile,
  type AgentContainerProfile,
} from "./agent-container-profiles.js";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toContainerPath(hostPath: string, hostRoot: string, containerRoot: string): string {
  if (hostPath === hostRoot) return containerRoot;
  const relative = path.relative(hostRoot, hostPath);
  if (relative === "" || relative === ".") return containerRoot;
  const normalizedRelative = relative.split(path.sep).join(path.posix.sep);
  return path.posix.join(containerRoot, normalizedRelative);
}

function normalizeHostAwareEnvPath(value: string | null, hostRoot: string | null, containerRoot: string): string | null {
  if (!value) return null;
  if (!hostRoot) return value;
  if (value === hostRoot || value.startsWith(`${hostRoot}${path.sep}`)) {
    return toContainerPath(value, hostRoot, containerRoot);
  }
  return value;
}

function toContainerRunner(baseRunner: RuntimeBundleRunner | null | undefined, profile: AgentContainerProfile): RuntimeBundleRunner {
  return {
    target: profile.runnerProvider,
    provider: profile.runnerProvider,
    workspaceStrategyType: baseRunner?.workspaceStrategyType ?? null,
    executionMode: baseRunner?.executionMode ?? null,
    browserCapable: profile.browserCapable,
    sandboxed: true,
    isolationBoundary: "container_process",
  };
}

function isSecretEnvName(name: string): boolean {
  const normalized = name.toUpperCase();
  return (
    normalized.includes("TOKEN") ||
    normalized.includes("KEY") ||
    normalized.includes("SECRET") ||
    normalized.includes("PASSWORD")
  );
}

function sortEnv(entries: AgentContainerEnvPlan[]): AgentContainerEnvPlan[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildAgentContainerLaunchPlan(input: {
  adapterType: string;
  runId: string;
  agentId: string;
  executionWorkspaceCwd: string;
  executionConfig: Record<string, unknown>;
  runtimeBundle: RuntimeBundle | null;
}): AgentContainerLaunchPlan {
  const profile = getAgentContainerProfile(input.adapterType);
  const envRecord = parseObject(input.executionConfig.env);
  const workspaceHostPath = input.executionWorkspaceCwd;
  const agentHomeHostPath =
    readString(envRecord[profile.homeEnvName]) ?? path.join(workspaceHostPath, ".paperclip", `${profile.adapterType}-home`);
  const sharedAuthSourceHostPath = profile.sharedAuthSourceEnvName
    ? readString(envRecord[profile.sharedAuthSourceEnvName])
    : null;
  const runtimeBundleHostRoot = readString(envRecord.PAPERCLIP_RUNTIME_ROOT);
  const managedRuntimeHostRoot = profile.managedRuntimeRootEnvName
    ? readString(envRecord[profile.managedRuntimeRootEnvName])
    : null;
  const sharedContextHostPath = readString(envRecord.PAPERCLIP_SHARED_CONTEXT_PATH);
  const image =
    (profile.imageEnvName ? readString(envRecord[profile.imageEnvName]) : null) ??
    readString(input.executionConfig.containerImage) ??
    profile.image;
  const configuredCommand =
    profile.managedRuntimeCommandEnvNames
      .map((name) => readString(envRecord[name]))
      .find((value): value is string => Boolean(value)) ??
    readString(input.executionConfig.command) ??
    profile.defaultCommand;
  const command = [
    normalizeHostAwareEnvPath(configuredCommand, managedRuntimeHostRoot, profile.managedRuntimeContainerPath ?? "") ?? configuredCommand,
    ...((Array.isArray(input.executionConfig.args)
      ? input.executionConfig.args.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : []) as string[]),
  ];

  const runtimeBundlePath = runtimeBundleHostRoot
    ? normalizeHostAwareEnvPath(readString(envRecord.PAPERCLIP_RUNTIME_BUNDLE_PATH), runtimeBundleHostRoot, profile.runtimeRootContainerPath)
    : null;
  const runtimeInstructionsPath = runtimeBundleHostRoot
    ? normalizeHostAwareEnvPath(
        readString(envRecord.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH),
        runtimeBundleHostRoot,
        profile.runtimeRootContainerPath,
      )
    : null;
  const runtimeApiHelperPath = runtimeBundleHostRoot
    ? normalizeHostAwareEnvPath(readString(envRecord.PAPERCLIP_API_HELPER_PATH), runtimeBundleHostRoot, profile.runtimeRootContainerPath)
    : null;
  const sharedContextContainerPath =
    sharedContextHostPath && sharedContextHostPath.startsWith(`${workspaceHostPath}${path.sep}`)
      ? toContainerPath(sharedContextHostPath, workspaceHostPath, AGENT_CONTAINER_WORKSPACE_PATH)
      : AGENT_CONTAINER_SHARED_CONTEXT_PATH;

  const env: AgentContainerEnvPlan[] = [];
  for (const [name, value] of Object.entries(envRecord)) {
    if (typeof value !== "string" || value.length === 0) continue;

    let nextValue = value;
    let source: AgentContainerEnvPlan["source"] = "resolved_config";

    if (name === profile.homeEnvName) {
      nextValue = profile.nativeHomePath;
      source = "worker_home";
    } else if (profile.sharedAuthSourceEnvName && name === profile.sharedAuthSourceEnvName && profile.sharedAuthContainerPath) {
      nextValue = profile.sharedAuthContainerPath;
      source = "shared_auth";
    } else if (profile.managedRuntimeRootEnvName && name === profile.managedRuntimeRootEnvName && profile.managedRuntimeContainerPath) {
      nextValue = profile.managedRuntimeContainerPath;
      source = "managed_runtime";
    } else if (profile.managedRuntimeCommandEnvNames.includes(name) && profile.managedRuntimeContainerPath) {
      nextValue = normalizeHostAwareEnvPath(value, managedRuntimeHostRoot, profile.managedRuntimeContainerPath) ?? value;
      source = "managed_runtime";
    } else if (name === "PAPERCLIP_RUNTIME_ROOT") {
      nextValue = profile.runtimeRootContainerPath;
      source = "runtime_bundle";
    } else if (name === "PAPERCLIP_RUNTIME_BUNDLE_PATH") {
      nextValue = runtimeBundlePath ?? value;
      source = "runtime_bundle";
    } else if (name === "PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH") {
      nextValue = runtimeInstructionsPath ?? value;
      source = "runtime_bundle";
    } else if (name === "PAPERCLIP_API_HELPER_PATH") {
      nextValue = runtimeApiHelperPath ?? value;
      source = "runtime_bundle";
    } else if (name === "PAPERCLIP_SHARED_CONTEXT_PATH") {
      nextValue = sharedContextContainerPath;
      source = "runtime_bundle";
    } else if (name === "TERMINAL_CWD") {
      nextValue = AGENT_CONTAINER_WORKSPACE_PATH;
      source = "paperclip_runtime";
    } else if (name.startsWith("PAPERCLIP_RUNTIME_") || name.startsWith("PAPERCLIP_SHARED_CONTEXT_")) {
      source = "runtime_bundle";
    } else if (name.startsWith("PAPERCLIP_")) {
      source = "paperclip_runtime";
    }

    env.push({ name, value: nextValue, secret: isSecretEnvName(name), source });
  }

  const mounts: AgentContainerLaunchPlan["mounts"] = [
    {
      kind: "workspace",
      hostPath: workspaceHostPath,
      containerPath: AGENT_CONTAINER_WORKSPACE_PATH,
      readOnly: false,
      purpose: "Primary execution workspace mounted read-write for agent task execution.",
    },
    {
      kind: "agent_home",
      hostPath: agentHomeHostPath,
      containerPath: profile.nativeHomePath,
      readOnly: false,
      purpose: "Worker-local native home for sessions, config materialization, and isolated runtime state.",
    },
  ];

  if (runtimeBundleHostRoot) {
    mounts.push({
      kind: "runtime_bundle",
      hostPath: runtimeBundleHostRoot,
      containerPath: profile.runtimeRootContainerPath,
      readOnly: true,
      purpose: "Paperclip runtime bundle projection and instructions for the current run.",
    });
  }

  if (managedRuntimeHostRoot && profile.managedRuntimeContainerPath) {
    mounts.push({
      kind: "managed_runtime",
      hostPath: managedRuntimeHostRoot,
      containerPath: profile.managedRuntimeContainerPath,
      readOnly: true,
      purpose: "Paperclip-managed adapter runtime cache mounted read-only for automatic runtime updates.",
    });
  }

  if (sharedAuthSourceHostPath && profile.sharedAuthContainerPath) {
    mounts.push({
      kind: "shared_auth",
      hostPath: sharedAuthSourceHostPath,
      containerPath: profile.sharedAuthContainerPath,
      readOnly: true,
      purpose: "Read-only shared auth/config source copied into the worker-local native home before execution.",
    });
  }

  if (!env.some((entry) => entry.name === profile.homeEnvName)) {
    env.push({
      name: profile.homeEnvName,
      value: profile.nativeHomePath,
      secret: false,
      source: "worker_home",
    });
  }

  return {
    version: "v1",
    adapterType: profile.adapterType,
    runner: toContainerRunner(input.runtimeBundle?.runner, profile),
    image,
    command,
    workingDir: profile.workingDir,
    workspacePath: AGENT_CONTAINER_WORKSPACE_PATH,
    nativeHomePath: profile.nativeHomePath,
    nativeSkillsPath: profile.nativeSkillsPath,
    agentHomePath: profile.nativeHomePath,
    sharedAuthSourcePath: sharedAuthSourceHostPath ? profile.sharedAuthContainerPath : null,
    runtimeBundleRoot: runtimeBundleHostRoot ? profile.runtimeRootContainerPath : null,
    sharedContextPath: runtimeBundleHostRoot ? sharedContextContainerPath : null,
    provider: readString(input.executionConfig.provider),
    model: readString(input.executionConfig.model),
    mounts,
    env: sortEnv(env),
    runtimeService: {
      serviceName: profile.serviceName,
      provider: profile.runnerProvider,
      scopeType: "run",
      scopeId: input.runId,
      ownerAgentId: input.agentId,
    },
  };
}

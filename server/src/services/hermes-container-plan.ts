import path from "node:path";
import type { HermesContainerEnvPlan, HermesContainerLaunchPlan, RuntimeBundle, RuntimeBundleRunner } from "@paperclipai/shared";
import { parseObject } from "../adapters/utils.js";

const DEFAULT_HERMES_CONTAINER_IMAGE = "paperclip/hermes-worker:dev";
const DEFAULT_SHARED_HERMES_HOME_SOURCE = "/paperclip/shared/hermes-home-source";
const CONTAINER_WORKSPACE_ROOT = "/workspace";
const CONTAINER_AGENT_HOME_ROOT = "/home/hermes/.hermes";
const CONTAINER_RUNTIME_ROOT = path.posix.join(CONTAINER_WORKSPACE_ROOT, ".paperclip", "runtime");
const CONTAINER_SHARED_AUTH_ROOT = "/paperclip/shared/hermes-home-source";
const CONTAINER_SHARED_CONTEXT_PATH = path.posix.join(CONTAINER_WORKSPACE_ROOT, ".paperclip", "context", "shared-context.json");

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

function normalizeHostAwareEnvPath(
  value: string | null,
  hostRoot: string | null,
  containerRoot: string,
): string | null {
  if (!value) return null;
  if (!hostRoot) return value;
  if (value === hostRoot || value.startsWith(`${hostRoot}${path.sep}`)) {
    return toContainerPath(value, hostRoot, containerRoot);
  }
  return value;
}

function toHermesContainerRunner(baseRunner: RuntimeBundleRunner | null | undefined): RuntimeBundleRunner {
  return {
    target: "hermes_container",
    provider: "hermes_container",
    workspaceStrategyType: baseRunner?.workspaceStrategyType ?? null,
    executionMode: baseRunner?.executionMode ?? null,
    browserCapable: false,
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

function sortEnv(entries: HermesContainerEnvPlan[]): HermesContainerEnvPlan[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildHermesContainerLaunchPlan(input: {
  runId: string;
  agentId: string;
  executionWorkspaceCwd: string;
  executionConfig: Record<string, unknown>;
  runtimeBundle: RuntimeBundle | null;
}): HermesContainerLaunchPlan {
  const envRecord = parseObject(input.executionConfig.env);
  const workspaceHostPath = input.executionWorkspaceCwd;
  const agentHomeHostPath = readString(envRecord.HERMES_HOME) ?? path.join(workspaceHostPath, ".paperclip", "hermes-home");
  const sharedAuthSourceHostPath =
    readString(envRecord.PAPERCLIP_HERMES_SHARED_HOME_SOURCE) ?? DEFAULT_SHARED_HERMES_HOME_SOURCE;
  const runtimeBundleHostRoot = readString(envRecord.PAPERCLIP_RUNTIME_ROOT);
  const sharedContextHostPath = readString(envRecord.PAPERCLIP_SHARED_CONTEXT_PATH);
  const image =
    readString(envRecord.PAPERCLIP_HERMES_CONTAINER_IMAGE) ??
    readString(input.executionConfig.containerImage) ??
    DEFAULT_HERMES_CONTAINER_IMAGE;
  const command = [
    readString(input.executionConfig.command) ?? "hermes",
    ...((Array.isArray(input.executionConfig.args)
      ? input.executionConfig.args.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : []) as string[]),
  ];

  const runtimeBundlePath = runtimeBundleHostRoot
    ? normalizeHostAwareEnvPath(readString(envRecord.PAPERCLIP_RUNTIME_BUNDLE_PATH), runtimeBundleHostRoot, CONTAINER_RUNTIME_ROOT)
    : null;
  const runtimeInstructionsPath = runtimeBundleHostRoot
    ? normalizeHostAwareEnvPath(
        readString(envRecord.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH),
        runtimeBundleHostRoot,
        CONTAINER_RUNTIME_ROOT,
      )
    : null;
  const runtimeApiHelperPath = runtimeBundleHostRoot
    ? normalizeHostAwareEnvPath(readString(envRecord.PAPERCLIP_API_HELPER_PATH), runtimeBundleHostRoot, CONTAINER_RUNTIME_ROOT)
    : null;
  const sharedContextContainerPath =
    sharedContextHostPath && sharedContextHostPath.startsWith(`${workspaceHostPath}${path.sep}`)
      ? toContainerPath(sharedContextHostPath, workspaceHostPath, CONTAINER_WORKSPACE_ROOT)
      : CONTAINER_SHARED_CONTEXT_PATH;

  const env: HermesContainerEnvPlan[] = [];
  for (const [name, value] of Object.entries(envRecord)) {
    if (typeof value !== "string" || value.length === 0) continue;

    let nextValue = value;
    let source: HermesContainerEnvPlan["source"] = "resolved_config";

    if (name === "HERMES_HOME") {
      nextValue = CONTAINER_AGENT_HOME_ROOT;
      source = "worker_home";
    } else if (name === "PAPERCLIP_HERMES_SHARED_HOME_SOURCE") {
      nextValue = CONTAINER_SHARED_AUTH_ROOT;
      source = "shared_auth";
    } else if (name === "PAPERCLIP_RUNTIME_ROOT") {
      nextValue = CONTAINER_RUNTIME_ROOT;
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
      nextValue = CONTAINER_WORKSPACE_ROOT;
      source = "paperclip_runtime";
    } else if (name.startsWith("PAPERCLIP_RUNTIME_") || name.startsWith("PAPERCLIP_SHARED_CONTEXT_")) {
      source = "runtime_bundle";
    } else if (name.startsWith("PAPERCLIP_")) {
      source = "paperclip_runtime";
    }

    env.push({
      name,
      value: nextValue,
      secret: isSecretEnvName(name),
      source,
    });
  }

  const mounts: HermesContainerLaunchPlan["mounts"] = [
    {
      kind: "workspace",
      hostPath: workspaceHostPath,
      containerPath: CONTAINER_WORKSPACE_ROOT,
      readOnly: false,
      purpose: "Primary execution workspace mounted read-write for Hermes task execution.",
    },
    {
      kind: "agent_home",
      hostPath: agentHomeHostPath,
      containerPath: CONTAINER_AGENT_HOME_ROOT,
      readOnly: false,
      purpose: "Worker-local Hermes home for sessions, config materialization, and isolated runtime state.",
    },
  ];

  if (runtimeBundleHostRoot) {
    mounts.push({
      kind: "runtime_bundle",
      hostPath: runtimeBundleHostRoot,
      containerPath: CONTAINER_RUNTIME_ROOT,
      readOnly: true,
      purpose: "Paperclip runtime bundle projection and instructions for the current run.",
    });
  }

  if (sharedAuthSourceHostPath) {
    mounts.push({
      kind: "shared_auth",
      hostPath: sharedAuthSourceHostPath,
      containerPath: CONTAINER_SHARED_AUTH_ROOT,
      readOnly: true,
      purpose: "Read-only shared Hermes auth source copied into the worker-local HERMES_HOME before execution.",
    });
  }

  if (!env.some((entry) => entry.name === "HERMES_HOME")) {
    env.push({
      name: "HERMES_HOME",
      value: CONTAINER_AGENT_HOME_ROOT,
      secret: false,
      source: "worker_home",
    });
  }

  return {
    version: "v1",
    runner: toHermesContainerRunner(input.runtimeBundle?.runner),
    image,
    command,
    workingDir: CONTAINER_WORKSPACE_ROOT,
    workspacePath: CONTAINER_WORKSPACE_ROOT,
    agentHomePath: CONTAINER_AGENT_HOME_ROOT,
    sharedAuthSourcePath: sharedAuthSourceHostPath ? CONTAINER_SHARED_AUTH_ROOT : null,
    runtimeBundleRoot: runtimeBundleHostRoot ? CONTAINER_RUNTIME_ROOT : null,
    sharedContextPath: runtimeBundleHostRoot ? sharedContextContainerPath : null,
    provider: readString(input.executionConfig.provider),
    model: readString(input.executionConfig.model),
    mounts,
    env: sortEnv(env),
    runtimeService: {
      serviceName: "hermes-worker",
      provider: "hermes_container",
      scopeType: "run",
      scopeId: input.runId,
      ownerAgentId: input.agentId,
    },
  };
}

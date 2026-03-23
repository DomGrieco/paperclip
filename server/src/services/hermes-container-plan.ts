import path from "node:path";
import type { HermesContainerEnvPlan, HermesContainerLaunchPlan, RuntimeBundle, RuntimeBundleRunner } from "@paperclipai/shared";
import { parseObject } from "../adapters/utils.js";

const DEFAULT_HERMES_CONTAINER_IMAGE = "paperclip/hermes-worker:dev";
const DEFAULT_SHARED_HERMES_HOME_SOURCE = "/paperclip/shared/hermes-home-source";
const CONTAINER_WORKSPACE_ROOT = "/workspace";
const CONTAINER_AGENT_HOME_ROOT = "/home/hermes/.hermes";
const CONTAINER_RUNTIME_ROOT = "/paperclip/runtime";
const CONTAINER_SHARED_AUTH_ROOT = "/paperclip/shared/hermes-auth-source";
const CONTAINER_SHARED_CONTEXT_PATH = "/paperclip/context/shared-context.json";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
  const workspacePath = input.executionWorkspaceCwd;
  const agentHomePath = readString(envRecord.HERMES_HOME) ?? path.join(workspacePath, ".paperclip", "hermes-home");
  const sharedAuthSourcePath =
    readString(envRecord.PAPERCLIP_HERMES_SHARED_HOME_SOURCE) ?? DEFAULT_SHARED_HERMES_HOME_SOURCE;
  const runtimeBundleRoot = readString(envRecord.PAPERCLIP_RUNTIME_ROOT);
  const sharedContextPath = readString(envRecord.PAPERCLIP_SHARED_CONTEXT_PATH);
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

  const env: HermesContainerEnvPlan[] = [];
  for (const [name, value] of Object.entries(envRecord)) {
    if (typeof value !== "string" || value.length === 0) continue;
    const source: HermesContainerEnvPlan["source"] =
      name === "HERMES_HOME"
        ? "worker_home"
        : name.startsWith("PAPERCLIP_RUNTIME_") || name.startsWith("PAPERCLIP_SHARED_CONTEXT_")
          ? "runtime_bundle"
          : name === "PAPERCLIP_HERMES_SHARED_HOME_SOURCE"
            ? "shared_auth"
            : name.startsWith("PAPERCLIP_")
              ? "paperclip_runtime"
              : "resolved_config";
    env.push({
      name,
      value,
      secret: isSecretEnvName(name),
      source,
    });
  }

  const mounts: HermesContainerLaunchPlan["mounts"] = [
    {
      kind: "workspace",
      hostPath: workspacePath,
      containerPath: CONTAINER_WORKSPACE_ROOT,
      readOnly: false,
      purpose: "Primary execution workspace mounted read-write for Hermes task execution.",
    },
    {
      kind: "agent_home",
      hostPath: agentHomePath,
      containerPath: CONTAINER_AGENT_HOME_ROOT,
      readOnly: false,
      purpose: "Worker-local Hermes home for sessions, config materialization, and isolated runtime state.",
    },
  ];

  if (runtimeBundleRoot) {
    mounts.push({
      kind: "runtime_bundle",
      hostPath: runtimeBundleRoot,
      containerPath: CONTAINER_RUNTIME_ROOT,
      readOnly: true,
      purpose: "Paperclip runtime bundle projection and instructions for the current run.",
    });
  }

  if (sharedAuthSourcePath) {
    mounts.push({
      kind: "shared_auth",
      hostPath: sharedAuthSourcePath,
      containerPath: CONTAINER_SHARED_AUTH_ROOT,
      readOnly: true,
      purpose: "Read-only shared Hermes auth source copied into the worker-local HERMES_HOME before execution.",
    });
  }

  if (!env.some((entry) => entry.name === "HERMES_HOME")) {
    env.push({
      name: "HERMES_HOME",
      value: agentHomePath,
      secret: false,
      source: "worker_home",
    });
  }

  return {
    version: "v1",
    runner: toHermesContainerRunner(input.runtimeBundle?.runner),
    image,
    command,
    workingDir: workspacePath,
    workspacePath,
    agentHomePath,
    sharedAuthSourcePath,
    runtimeBundleRoot,
    sharedContextPath: sharedContextPath ?? (runtimeBundleRoot ? CONTAINER_SHARED_CONTEXT_PATH : null),
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

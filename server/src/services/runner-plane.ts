import type { RuntimeBundleRunner } from "@paperclipai/shared";
import type { RuntimeServiceRef } from "./workspace-runtime.js";

export function resolvePlannedRunnerSnapshot(projectPolicy: Record<string, unknown> | null): RuntimeBundleRunner {
  const workspaceStrategy =
    projectPolicy && typeof projectPolicy.workspaceStrategy === "object" && projectPolicy.workspaceStrategy
      ? (projectPolicy.workspaceStrategy as Record<string, unknown>)
      : null;
  const defaultMode =
    projectPolicy && typeof projectPolicy.defaultMode === "string" ? (projectPolicy.defaultMode as string) : null;
  const strategyType =
    workspaceStrategy && typeof workspaceStrategy.type === "string" ? (workspaceStrategy.type as string) : null;

  if (strategyType === "cloud_sandbox") {
    return {
      target: "cloud_sandbox",
      provider: "cloud_sandbox",
      workspaceStrategyType: strategyType,
      executionMode: defaultMode,
      browserCapable: true,
      sandboxed: true,
      isolationBoundary: "cloud_sandbox",
    };
  }

  if (strategyType === "adapter_managed") {
    return {
      target: "adapter_managed",
      provider: "adapter_managed",
      workspaceStrategyType: strategyType,
      executionMode: defaultMode,
      browserCapable: false,
      sandboxed: true,
      isolationBoundary: "adapter_runtime",
    };
  }

  return {
    target: "local_host",
    provider: "local_process",
    workspaceStrategyType: strategyType,
    executionMode: defaultMode,
    browserCapable: false,
    sandboxed: false,
    isolationBoundary: "host_process",
  };
}

export function resolveObservedRunnerSnapshot(input: {
  planned: RuntimeBundleRunner;
  runtimeServices?: RuntimeServiceRef[] | null;
}): RuntimeBundleRunner {
  const services = input.runtimeServices ?? [];
  const hermesContainers = services.filter((service) => service.provider === "hermes_container");
  if (hermesContainers.length > 0) {
    return {
      target: "hermes_container",
      provider: "hermes_container",
      workspaceStrategyType: input.planned.workspaceStrategyType,
      executionMode: input.planned.executionMode,
      browserCapable: hermesContainers.some((service) => Boolean(service.url)),
      sandboxed: true,
      isolationBoundary: "container_process",
    };
  }

  const agentContainers = services.filter((service) => service.provider === "agent_container");
  if (agentContainers.length > 0) {
    return {
      target: "agent_container",
      provider: "agent_container",
      workspaceStrategyType: input.planned.workspaceStrategyType,
      executionMode: input.planned.executionMode,
      browserCapable: agentContainers.some((service) => Boolean(service.url)),
      sandboxed: true,
      isolationBoundary: "container_process",
    };
  }

  const adapterManaged = services.filter((service) => service.provider === "adapter_managed");
  if (adapterManaged.length === 0) return input.planned;

  return {
    target: "adapter_managed",
    provider: "adapter_managed",
    workspaceStrategyType: input.planned.workspaceStrategyType,
    executionMode: input.planned.executionMode,
    browserCapable: adapterManaged.some((service) => Boolean(service.url)),
    sandboxed: true,
    isolationBoundary: "adapter_runtime",
  };
}


export function applyVerificationRunnerPolicy(input: {
  planned: RuntimeBundleRunner;
  runType: string | null;
  evidencePolicy: string;
}): RuntimeBundleRunner {
  if (
    input.runType === "verification" &&
    input.evidencePolicy === "code_ci_evaluator_summary_artifacts" &&
    input.planned.target === "local_host"
  ) {
    return {
      target: "cloud_sandbox",
      provider: "cloud_sandbox",
      workspaceStrategyType: input.planned.workspaceStrategyType,
      executionMode: input.planned.executionMode,
      browserCapable: true,
      sandboxed: true,
      isolationBoundary: "cloud_sandbox",
    };
  }

  return input.planned;
}


import type { HermesContainerLaunchPlan, RuntimeBundle } from "@paperclipai/shared";
import { buildAgentContainerLaunchPlan } from "./agent-container-plan.js";

export function buildHermesContainerLaunchPlan(input: {
  runId: string;
  agentId: string;
  executionWorkspaceCwd: string;
  executionConfig: Record<string, unknown>;
  runtimeBundle: RuntimeBundle | null;
}): HermesContainerLaunchPlan {
  return buildAgentContainerLaunchPlan({
    adapterType: "hermes_local",
    runId: input.runId,
    agentId: input.agentId,
    executionWorkspaceCwd: input.executionWorkspaceCwd,
    executionConfig: input.executionConfig,
    runtimeBundle: input.runtimeBundle,
  });
}

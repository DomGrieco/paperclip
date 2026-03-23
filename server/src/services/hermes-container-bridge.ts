import { createHash } from "node:crypto";
import type { AdapterExecutionContext, AdapterRuntimeServiceReport } from "@paperclipai/adapter-utils";
import { parseObject } from "../adapters/utils.js";

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
}

export function isHermesContainerBridgeEnabled(ctx: Pick<AdapterExecutionContext, "config">): boolean {
  const explicitEnv = readBoolean(process.env.PAPERCLIP_HERMES_CONTAINER_BRIDGE_ENABLED);
  if (explicitEnv !== null) return explicitEnv;

  const runtime = parseObject(ctx.config.workspaceRuntime);
  const hermesContainerBridge = parseObject(runtime.hermesContainerBridge);
  const explicitConfig = readBoolean(hermesContainerBridge.enabled);
  return explicitConfig === true;
}

function stableBridgeRuntimeServiceId(input: { runId: string; serviceName: string; providerRef: string | null }): string {
  const hex = createHash("sha256")
    .update(`${input.runId}:${input.serviceName}:${input.providerRef ?? ""}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function buildHermesContainerBridgeRuntimeServices(
  ctx: Pick<AdapterExecutionContext, "runId" | "agent" | "config" | "context">,
): AdapterRuntimeServiceReport[] {
  if (!isHermesContainerBridgeEnabled(ctx)) return [];
  const plan = parseObject(ctx.context.paperclipHermesContainerPlan);
  const runtimeService = parseObject(plan.runtimeService);
  const runner = parseObject(plan.runner);
  const command = Array.isArray(plan.command)
    ? plan.command.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (
    runner.provider !== "hermes_container" ||
    typeof runtimeService.serviceName !== "string" ||
    runtimeService.serviceName.trim().length === 0
  ) {
    return [];
  }

  const providerRef =
    typeof plan.image === "string" && plan.image.trim().length > 0
      ? `launch-plan:${plan.image}`
      : "launch-plan";

  return [
    {
      id: stableBridgeRuntimeServiceId({
        runId: ctx.runId,
        serviceName: runtimeService.serviceName,
        providerRef,
      }),
      serviceName: runtimeService.serviceName,
      provider: "hermes_container",
      providerRef,
      scopeType: runtimeService.scopeType === "run" ? "run" : "run",
      scopeId: typeof runtimeService.scopeId === "string" && runtimeService.scopeId.trim().length > 0 ? runtimeService.scopeId : ctx.runId,
      lifecycle: "ephemeral",
      status: "running",
      command: command.length > 0 ? command.join(" ") : null,
      cwd: typeof plan.workingDir === "string" ? plan.workingDir : null,
      ownerAgentId:
        typeof runtimeService.ownerAgentId === "string" && runtimeService.ownerAgentId.trim().length > 0
          ? runtimeService.ownerAgentId
          : ctx.agent.id,
      stopPolicy: { type: "on_run_finish" },
      healthStatus: "healthy",
    },
  ];
}

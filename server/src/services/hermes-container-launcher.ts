import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as http from "node:http";
import type { HermesContainerLaunchPlan } from "@paperclipai/shared";
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

export function isHermesContainerLauncherEnabled(config: Record<string, unknown>): boolean {
  const explicitEnv = readBoolean(process.env.PAPERCLIP_HERMES_CONTAINER_LAUNCHER_ENABLED);
  if (explicitEnv !== null) return explicitEnv;
  const runtime = parseObject(config.workspaceRuntime);
  const launcher = parseObject(runtime.hermesContainerLauncher);
  return readBoolean(launcher.enabled) === true;
}

export function injectHermesContainerLauncherService(input: {
  config: Record<string, unknown>;
  plan: HermesContainerLaunchPlan | null;
}): Record<string, unknown> {
  if (!input.plan || !isHermesContainerLauncherEnabled(input.config)) return input.config;
  const runtime = parseObject(input.config.workspaceRuntime);
  const existingServices = Array.isArray(runtime.services)
    ? runtime.services.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
  const nextServices = [
    ...existingServices,
    {
      name: input.plan.runtimeService.serviceName,
      provider: "hermes_container",
      lifecycle: "ephemeral",
      stopPolicy: { type: "on_run_finish" },
      hermesContainerPlan: input.plan,
    },
  ];
  return {
    ...input.config,
    workspaceRuntime: {
      ...runtime,
      services: nextServices,
    },
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "service";
}

export function stableHermesContainerRuntimeServiceId(input: {
  runId: string;
  serviceName: string;
  image: string;
}): string {
  const hex = createHash("sha256")
    .update(`${input.runId}:${input.serviceName}:${input.image}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function commandSucceeds(command: string, args: string[]): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function resolveHermesContainerImage(preferredImage: string): Promise<string> {
  const explicitFallback = process.env.PAPERCLIP_HERMES_CONTAINER_FALLBACK_IMAGE;
  if (typeof explicitFallback === "string" && explicitFallback.trim().length > 0) {
    return explicitFallback.trim();
  }
  const candidates = [preferredImage, "paperclip-server:latest"].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  for (const candidate of candidates) {
    if (await commandSucceeds("docker", ["image", "inspect", candidate])) return candidate;
  }
  return preferredImage;
}

export function buildHermesContainerDockerArgs(input: {
  runId: string;
  agentId: string;
  serviceId: string;
  image: string;
  plan: HermesContainerLaunchPlan;
}): string[] {
  const containerName = `paperclip-hermes-${slugify(input.runId).slice(0, 18)}-${slugify(input.serviceId).slice(0, 12)}`;
  const args: string[] = [
    "run",
    "-d",
    "--rm",
    "--init",
    "--name",
    containerName,
    "--label",
    `paperclip.runtime_service_id=${input.serviceId}`,
    "--label",
    `paperclip.run_id=${input.runId}`,
    "--label",
    `paperclip.agent_id=${input.agentId}`,
    "--workdir",
    input.plan.workingDir,
  ];

  for (const mount of input.plan.mounts) {
    args.push("-v", `${mount.hostPath}:${mount.containerPath}${mount.readOnly ? ":ro" : ""}`);
  }
  for (const env of input.plan.env) {
    args.push("-e", `${env.name}=${env.value}`);
  }

  args.push(
    input.image,
    "sh",
    "-lc",
    "trap 'exit 0' TERM INT; while :; do sleep 30; done",
  );
  return args;
}

function buildContainerName(input: { runId: string; serviceId: string }): string {
  return `paperclip-hermes-${slugify(input.runId).slice(0, 18)}-${slugify(input.serviceId).slice(0, 12)}`;
}

async function dockerApiRequest(input: {
  method: string;
  path: string;
  body?: unknown;
}): Promise<{ statusCode: number; body: string }> {
  const payload = input.body === undefined ? null : JSON.stringify(input.body);
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: "/var/run/docker.sock",
        path: `/v1.41${input.path}`,
        method: input.method,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export type DockerContainerMount = {
  Type?: string;
  Source?: string;
  Destination?: string;
  RW?: boolean;
};

export function resolveMountSourcePath(input: {
  containerPath: string;
  mounts: DockerContainerMount[];
}): string {
  const sortedMounts = [...input.mounts]
    .filter(
      (mount): mount is DockerContainerMount & { Source: string; Destination: string } =>
        typeof mount.Source === "string" && typeof mount.Destination === "string",
    )
    .sort((a, b) => b.Destination.length - a.Destination.length);
  for (const mount of sortedMounts) {
    if (input.containerPath === mount.Destination) return mount.Source;
    if (input.containerPath.startsWith(`${mount.Destination}/`)) {
      return `${mount.Source}${input.containerPath.slice(mount.Destination.length)}`;
    }
  }
  throw new Error(`No source mount found for container path ${input.containerPath}`);
}

async function inspectContainerDetails(containerName: string): Promise<{
  mounts: DockerContainerMount[];
  networkNames: string[];
}> {
  const response = await dockerApiRequest({
    method: "GET",
    path: `/containers/${encodeURIComponent(containerName)}/json`,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`docker inspect failed (${response.statusCode}): ${response.body}`);
  }
  const parsed = JSON.parse(response.body) as {
    Mounts?: DockerContainerMount[];
    NetworkSettings?: { Networks?: Record<string, unknown> };
  };
  const mounts = Array.isArray(parsed.Mounts) ? parsed.Mounts : [];
  const networkNames = parsed.NetworkSettings?.Networks ? Object.keys(parsed.NetworkSettings.Networks) : [];
  return { mounts, networkNames };
}

export function buildDockerBindsFromPlan(input: {
  plan: HermesContainerLaunchPlan;
  sourceContainerMounts: DockerContainerMount[];
}): string[] {
  return input.plan.mounts.map((mount) => {
    const sourcePath = resolveMountSourcePath({
      containerPath: mount.hostPath,
      mounts: input.sourceContainerMounts,
    });
    return `${sourcePath}:${mount.containerPath}${mount.readOnly ? ":ro" : ""}`;
  });
}

export async function createAndStartHermesContainer(input: {
  runId: string;
  agentId: string;
  serviceId: string;
  image: string;
  plan: HermesContainerLaunchPlan;
  workspaceCwd: string;
}): Promise<string> {
  const containerName = buildContainerName({ runId: input.runId, serviceId: input.serviceId });
  const sourceContainer = process.env.PAPERCLIP_HERMES_CONTAINER_SOURCE_CONTAINER || "paperclip-server-1";
  const sourceContainerDetails = await inspectContainerDetails(sourceContainer);
  const binds = buildDockerBindsFromPlan({
    plan: input.plan,
    sourceContainerMounts: sourceContainerDetails.mounts,
  });
  const networkMode = sourceContainerDetails.networkNames[0] ?? null;
  const createResponse = await dockerApiRequest({
    method: "POST",
    path: `/containers/create?name=${encodeURIComponent(containerName)}`,
    body: {
      Image: input.image,
      User: "0:0",
      WorkingDir: input.plan.workingDir,
      Cmd: ["sh", "-lc", "trap 'exit 0' TERM INT; while :; do sleep 30; done"],
      Env: input.plan.env.map((entry) => `${entry.name}=${entry.value}`),
      Labels: {
        "paperclip.runtime_service_id": input.serviceId,
        "paperclip.run_id": input.runId,
        "paperclip.agent_id": input.agentId,
        "paperclip.launch_plan_image": input.plan.image,
      },
      HostConfig: {
        AutoRemove: true,
        Init: true,
        Binds: binds,
        ...(networkMode ? { NetworkMode: networkMode } : {}),
      },
    },
  });
  if (createResponse.statusCode < 200 || createResponse.statusCode >= 300) {
    throw new Error(`docker create failed (${createResponse.statusCode}): ${createResponse.body}`);
  }
  const parsed = JSON.parse(createResponse.body) as { Id?: string };
  const containerId = typeof parsed.Id === "string" ? parsed.Id : null;
  if (!containerId) throw new Error("docker create returned no container id");
  const startResponse = await dockerApiRequest({
    method: "POST",
    path: `/containers/${encodeURIComponent(containerId)}/start`,
  });
  if (startResponse.statusCode < 200 || startResponse.statusCode >= 300) {
    throw new Error(`docker start failed (${startResponse.statusCode}): ${startResponse.body}`);
  }
  return containerId;
}

export async function removeHermesContainer(containerId: string): Promise<void> {
  await dockerApiRequest({
    method: "DELETE",
    path: `/containers/${encodeURIComponent(containerId)}?force=1`,
  }).catch(() => undefined);
}

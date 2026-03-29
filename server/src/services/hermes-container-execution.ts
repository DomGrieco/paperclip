import * as http from "node:http";
import { buildPaperclipEnv, renderTemplate } from "@paperclipai/adapter-utils/server-utils";
import type { AdapterExecutionContext, AdapterExecutionResult, UsageSummary } from "../adapters/types.js";
import { buildPaperclipApiGovernanceSummary, derivePaperclipApiGovernancePolicy } from "./hermes-governance.js";
import { resolveHermesContainerApiUrl } from "./hermes-container-launcher.js";

const HERMES_CLI = "hermes";
const DEFAULT_TIMEOUT_SEC = 300;
const DEFAULT_MODEL = "anthropic/claude-sonnet-4";
const VALID_PROVIDERS = [
  "auto",
  "openrouter",
  "nous",
  "openai-codex",
  "zai",
  "kimi-coding",
  "minimax",
  "minimax-cn",
] as const;
const CONTAINER_WORKDIR = "/workspace";
const CONTAINER_HERMES_HOME = "/home/hermes/.hermes";
const CONTAINER_RUNTIME_ROOT = `${CONTAINER_WORKDIR}/.paperclip/runtime`;
const CONTAINER_RUNTIME_BUNDLE_PATH = `${CONTAINER_RUNTIME_ROOT}/bundle.json`;
const CONTAINER_RUNTIME_INSTRUCTIONS_PATH = `${CONTAINER_RUNTIME_ROOT}/instructions.md`;
const CONTAINER_API_HELPER_PATH = `${CONTAINER_RUNTIME_ROOT}/paperclip-api`;
const CONTAINER_SHARED_CONTEXT_PATH = `${CONTAINER_WORKDIR}/.paperclip/context/shared-context.json`;
const SESSION_ID_REGEX = /^session_id:\s*(\S+)/m;
const SESSION_ID_REGEX_LEGACY = /session[_ ](?:id|saved)[:\s]+([a-zA-Z0-9_-]+)/i;
const COST_REGEX = /(?:cost|spent)[:\s]*\$?([\d.]+)/i;
const TOKEN_USAGE_REGEX = /tokens?[^\d]*(\d+)[^\d]+(\d+)/i;

const DEFAULT_PROMPT_TEMPLATE = `You are "{{agentName}}", an AI agent employee in a Paperclip-managed company.

Paperclip runtime rules:
- Use \`$PAPERCLIP_API_HELPER_PATH\` for normal Paperclip API calls whenever it is available. It automatically attaches auth headers and prints JSON/text responses.
- \`$PAPERCLIP_API_HELPER_PATH\` already uses the configured \`$PAPERCLIP_API_URL\`. Do not re-export or rewrite \`PAPERCLIP_API_URL\` before helper calls.
- \`$PAPERCLIP_API_URL\` points at the Paperclip server root. Keep helper targets as \`/api/...\` paths instead of appending another base prefix yourself.
- Treat raw \`curl\` as last-resort debugging only.
- Read \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\`, \`$PAPERCLIP_RUNTIME_BUNDLE_PATH\`, and \`$PAPERCLIP_SHARED_CONTEXT_PATH\` first when they are available.
- Do not expand that initial read into \`policy.json\`, \`runner.json\`, \`verification.json\`, broad file discovery, or repeated re-reads unless the task explicitly requires it or the first three files point you there.
- After those files are readable, do not broadly spelunk the environment. Prefer the narrowest path that completes the assigned work and leaves reviewable evidence.
- Do not probe unrelated Paperclip routes or \`/api/health\` unless a specific helper/API call fails and you are gathering evidence for that failure.
- If a helper call fails, record that exact failure and stop to reassess. Do not pivot into host/IP probing, ad-hoc Python HTTP scripts, or broad environment scans.
- If \`$PAPERCLIP_API_POLICY_SUMMARY\` is set, treat it as the exact helper allowlist contract for this run. Do not call helper endpoints outside that contract.
- In an already-running assigned issue execution, do not call \`/api/agents/{agentId}/wakeup\` to "start" yourself again unless the task explicitly asks you to validate wakeup semantics.
- Do not try to prove that prohibition by attempting the wakeup call anyway. Treat \`/api/agents/{agentId}/wakeup\`, top-level \`/api/runs\`, bare \`/api\`, and other broad discovery endpoints as forbidden unless the task explicitly requires them.
- Avoid repeated status polling of the same issue/agent/run endpoints. Fetch what you need once, act, then do at most one final confirmation read.
- Aim to finish decisively: restate the objective, perform the smallest useful set of API reads/writes, leave evidence, and stop once the task is complete.

Your Paperclip identity:
  Agent ID: {{agentId}}
  Company ID: {{companyId}}
  API Base: {{paperclipApiUrl}}

{{#taskId}}
## Assigned Task

Issue ID: {{taskId}}
Title: {{taskTitle}}

{{taskBody}}

## Workflow

1. Read the runtime files first, then use the runtime bundle plus the current task details as your source of truth.
2. Complete the task using your tools.
3. When done, update the issue status:
   \`$PAPERCLIP_API_HELPER_PATH patch /api/issues/{{taskId}} --json '{"status":"done"}'\`
4. Report what you changed and any evidence/artifacts produced.
{{/taskId}}

{{#noTask}}
## Heartbeat Wake — Check for Work

1. Check your assigned todo issues:
   \`$PAPERCLIP_API_HELPER_PATH get "/api/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}&status=todo"\`
2. If an issue is available, pick the highest-priority one, work it, and update its status when complete.
3. If nothing is assigned, exit briefly and clearly.
{{/noTask}}`;

function cfgString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function cfgNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function cfgBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function cfgStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((i) => typeof i === "string") ? v : undefined;
}

function cfgRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function getIssueDescriptionFromRuntimeMemory(runtimeBundle: Record<string, unknown> | undefined): string {
  const memory = cfgRecord(runtimeBundle?.memory);
  const snippets = Array.isArray(memory?.snippets) ? memory.snippets : [];
  for (const snippet of snippets) {
    const record = cfgRecord(snippet);
    if (cfgString(record?.source) === "issue.description") {
      return cfgString(record?.content) || "";
    }
  }
  return "";
}

export function buildPrompt(ctx: AdapterExecutionContext, config: Record<string, unknown>): string {
  const template = cfgString(config.promptTemplate) || DEFAULT_PROMPT_TEMPLATE;
  const runtimeBundle = cfgRecord(ctx.context?.paperclipRuntimeBundle);
  const runtimeIssue = cfgRecord(runtimeBundle?.issue);
  const runtimeProject = cfgRecord(runtimeBundle?.project);
  const taskId =
    cfgString(ctx.config?.taskId) ||
    cfgString(ctx.context?.taskId) ||
    cfgString(ctx.context?.issueId) ||
    cfgString(runtimeIssue?.id);
  const taskTitle = cfgString(ctx.config?.taskTitle) || cfgString(runtimeIssue?.title) || "";
  const taskBody =
    cfgString(ctx.config?.taskBody) ||
    getIssueDescriptionFromRuntimeMemory(runtimeBundle) ||
    "";
  const agentName = ctx.agent?.name || "Hermes Agent";
  const companyName = cfgString(ctx.config?.companyName) || "";
  const projectName = cfgString(ctx.config?.projectName) || cfgString(runtimeProject?.name) || "";
  const paperclipApiUrl =
    cfgString(config.paperclipApiUrl) || process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100";
  const apiGovernancePolicy = derivePaperclipApiGovernancePolicy({
    taskId: taskId || null,
    agentId: ctx.agent?.id || null,
    taskTitle: taskTitle || null,
    taskBody: taskBody || null,
  });
  const apiPolicySummary = buildPaperclipApiGovernanceSummary(apiGovernancePolicy);
  const vars = {
    agentId: ctx.agent?.id || "",
    agentName,
    companyId: ctx.agent?.companyId || "",
    companyName,
    runId: ctx.runId || "",
    taskId: taskId || "",
    taskTitle,
    taskBody,
    projectName,
    paperclipApiUrl,
  };
  let rendered = template;
  rendered = rendered.replace(/\{\{#taskId\}\}([\s\S]*?)\{\{\/taskId\}\}/g, taskId ? "$1" : "");
  rendered = rendered.replace(/\{\{#noTask\}\}([\s\S]*?)\{\{\/noTask\}\}/g, taskId ? "" : "$1");
  const renderedPrompt = renderTemplate(rendered, vars);
  if (!apiPolicySummary) return renderedPrompt;
  return `${renderedPrompt}\n\n## Governed API contract\n${apiPolicySummary}\nAny helper call outside this contract will be rejected before it reaches the Paperclip API.`;
}

function parseHermesOutput(stdout: string, stderr: string): {
  response?: string;
  sessionId?: string;
  errorMessage?: string;
  usage?: UsageSummary;
  costUsd?: number;
} {
  const combined = `${stdout}\n${stderr}`;
  const result: {
    response?: string;
    sessionId?: string;
    errorMessage?: string;
    usage?: UsageSummary;
    costUsd?: number;
  } = {};
  const sessionMatch = stdout.match(SESSION_ID_REGEX);
  if (sessionMatch?.[1]) {
    result.sessionId = sessionMatch[1];
    const sessionLineIdx = stdout.lastIndexOf("\nsession_id:");
    if (sessionLineIdx > 0) {
      result.response = stdout.slice(0, sessionLineIdx).trim();
    }
  } else {
    const legacyMatch = combined.match(SESSION_ID_REGEX_LEGACY);
    if (legacyMatch?.[1]) result.sessionId = legacyMatch[1];
  }
  const usageMatch = combined.match(TOKEN_USAGE_REGEX);
  if (usageMatch) {
    result.usage = {
      inputTokens: Number.parseInt(usageMatch[1] ?? "0", 10) || 0,
      outputTokens: Number.parseInt(usageMatch[2] ?? "0", 10) || 0,
    };
  }
  const costMatch = combined.match(COST_REGEX);
  if (costMatch?.[1]) {
    result.costUsd = Number.parseFloat(costMatch[1]);
  }
  if (stderr.trim()) {
    const errorLines = stderr
      .split("\n")
      .filter((line) => /error|exception|traceback|failed/i.test(line))
      .filter((line) => !/INFO|DEBUG|warn/i.test(line));
    if (errorLines.length > 0) {
      result.errorMessage = errorLines.slice(0, 5).join("\n");
    }
  }
  return result;
}

async function dockerApiJson(input: {
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

async function createDockerExec(input: {
  containerId: string;
  cmd: string[];
  env: Record<string, string>;
}): Promise<string> {
  const response = await dockerApiJson({
    method: "POST",
    path: `/containers/${encodeURIComponent(input.containerId)}/exec`,
    body: {
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: CONTAINER_WORKDIR,
      Env: Object.entries(input.env).map(([name, value]) => `${name}=${value}`),
      Cmd: input.cmd,
    },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`docker exec create failed (${response.statusCode}): ${response.body}`);
  }
  const parsed = JSON.parse(response.body) as { Id?: string };
  if (!parsed.Id) throw new Error("docker exec create returned no exec id");
  return parsed.Id;
}

async function startDockerExecStreaming(input: {
  execId: string;
  onChunk: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}): Promise<void> {
  const payload = JSON.stringify({ Detach: false, Tty: false });
  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        socketPath: "/var/run/docker.sock",
        path: `/v1.41/exec/${encodeURIComponent(input.execId)}/start`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
          let errorBody = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            errorBody += chunk;
          });
          res.on("end", () => reject(new Error(`docker exec start failed (${res.statusCode}): ${errorBody}`)));
          return;
        }
        let buffer = Buffer.alloc(0);
        const drain = async () => {
          while (buffer.length >= 8) {
            const frameSize = buffer.readUInt32BE(4);
            if (buffer.length < 8 + frameSize) return;
            const frameType = buffer[0] === 2 ? "stderr" : "stdout";
            const payload = buffer.subarray(8, 8 + frameSize).toString("utf8");
            buffer = buffer.subarray(8 + frameSize);
            void input.onChunk(frameType, payload);
          }
        };
        res.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
          void drain();
        });
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function inspectDockerExec(execId: string): Promise<number | null> {
  const response = await dockerApiJson({
    method: "GET",
    path: `/exec/${encodeURIComponent(execId)}/json`,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return null;
  }
  const parsed = JSON.parse(response.body) as { ExitCode?: number | null };
  return typeof parsed.ExitCode === "number" ? parsed.ExitCode : null;
}

function findHermesContainerId(ctx: AdapterExecutionContext): string | null {
  const services = Array.isArray(ctx.context?.paperclipRuntimeServices)
    ? (ctx.context.paperclipRuntimeServices as Array<Record<string, unknown>>)
    : [];
  for (const service of services) {
    if (service?.provider === "hermes_container" && typeof service.providerRef === "string" && service.providerRef.trim().length > 0) {
      return service.providerRef.trim();
    }
  }
  return null;
}

export async function executeHermesInContainer(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const rawConfig = (ctx.agent?.adapterConfig ?? {}) as Record<string, unknown>;
  const paperclipApiUrl =
    cfgString(rawConfig.paperclipApiUrl) ||
    (await resolveHermesContainerApiUrl());
  const config: Record<string, unknown> = {
    ...rawConfig,
    paperclipApiUrl,
  };
  const containerId = findHermesContainerId(ctx);
  if (!containerId) {
    throw new Error("Hermes container execution requested but no launched hermes_container runtime service was found in context.paperclipRuntimeServices");
  }

  const hermesCmd = cfgString(config.hermesCommand) || HERMES_CLI;
  const model = cfgString(config.model) || DEFAULT_MODEL;
  const provider = cfgString(config.provider);
  const timeoutSec = cfgNumber(config.timeoutSec) || DEFAULT_TIMEOUT_SEC;
  const toolsets = cfgString(config.toolsets) || cfgStringArray(config.enabledToolsets)?.join(",");
  const extraArgs = cfgStringArray(config.extraArgs);
  const persistSession = cfgBoolean(config.persistSession) !== false;
  const worktreeMode = cfgBoolean(config.worktreeMode) === true;
  const checkpoints = cfgBoolean(config.checkpoints) === true;
  const useQuiet = cfgBoolean(config.quiet) !== false;
  const prompt = buildPrompt(ctx, config);
  const args = ["chat", "-q", prompt];
  if (useQuiet) args.push("-Q");
  args.push("-m", model);
  if (provider && (VALID_PROVIDERS as readonly string[]).indexOf(provider) >= 0) {
    args.push("--provider", provider);
  }
  if (toolsets) args.push("-t", toolsets);
  if (worktreeMode) args.push("-w");
  if (checkpoints) args.push("--checkpoints");
  if (cfgBoolean(config.verbose) === true) args.push("-v");
  const prevSessionId = cfgString(ctx.runtime?.sessionParams?.sessionId);
  if (persistSession && prevSessionId) {
    args.push("--resume", prevSessionId);
  }
  if (extraArgs?.length) args.push(...extraArgs);

  const execEnv = {
    ...buildPaperclipEnv(ctx.agent),
    PAPERCLIP_RUN_ID: ctx.runId,
    PAPERCLIP_API_URL: paperclipApiUrl,
    HERMES_HOME: CONTAINER_HERMES_HOME,
    TERMINAL_CWD: CONTAINER_WORKDIR,
    PAPERCLIP_API_HELPER_PATH: CONTAINER_API_HELPER_PATH,
  } as Record<string, string>;
  const taskId = cfgString(ctx.config?.taskId);
  if (taskId) execEnv.PAPERCLIP_TASK_ID = taskId;
  const userEnv = config.env;
  if (userEnv && typeof userEnv === "object") {
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_API_KEY === "string") {
      execEnv.PAPERCLIP_API_KEY = (userEnv as Record<string, string>).PAPERCLIP_API_KEY;
    }
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_ISSUE_ID === "string") {
      execEnv.PAPERCLIP_ISSUE_ID = (userEnv as Record<string, string>).PAPERCLIP_ISSUE_ID;
    }
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_PROJECT_ID === "string") {
      execEnv.PAPERCLIP_PROJECT_ID = (userEnv as Record<string, string>).PAPERCLIP_PROJECT_ID;
    }
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_RUNTIME_ROOT === "string") {
      execEnv.PAPERCLIP_RUNTIME_ROOT = CONTAINER_RUNTIME_ROOT;
    }
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_RUNTIME_BUNDLE_PATH === "string") {
      execEnv.PAPERCLIP_RUNTIME_BUNDLE_PATH = CONTAINER_RUNTIME_BUNDLE_PATH;
    }
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH === "string") {
      execEnv.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH = CONTAINER_RUNTIME_INSTRUCTIONS_PATH;
    }
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_SHARED_CONTEXT_PATH === "string") {
      execEnv.PAPERCLIP_SHARED_CONTEXT_PATH = CONTAINER_SHARED_CONTEXT_PATH;
    }
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_SHARED_CONTEXT_JSON === "string") {
      execEnv.PAPERCLIP_SHARED_CONTEXT_JSON = (userEnv as Record<string, string>).PAPERCLIP_SHARED_CONTEXT_JSON;
    }
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_RUNTIME_BUNDLE_JSON === "string") {
      execEnv.PAPERCLIP_RUNTIME_BUNDLE_JSON = (userEnv as Record<string, string>).PAPERCLIP_RUNTIME_BUNDLE_JSON;
    }
    if (typeof (userEnv as Record<string, unknown>).PAPERCLIP_MEMORY_RECALL_JSON === "string") {
      execEnv.PAPERCLIP_MEMORY_RECALL_JSON = (userEnv as Record<string, string>).PAPERCLIP_MEMORY_RECALL_JSON;
    }
  }

  await ctx.onMeta?.({
    adapterType: "hermes_local",
    command: hermesCmd,
    commandArgs: args,
    cwd: CONTAINER_WORKDIR,
    env: execEnv,
  });

  await ctx.onLog("stdout", `[hermes] Starting Hermes Agent in hermes_container ${containerId.slice(0, 12)} (model=${model}, timeout=${timeoutSec}s)\n`);
  if (prevSessionId) {
    await ctx.onLog("stdout", `[hermes] Resuming session: ${prevSessionId}\n`);
  }

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const execId = await createDockerExec({
    containerId,
    cmd: [hermesCmd, ...args],
    env: execEnv,
  });

  const streamPromise = startDockerExecStreaming({
    execId,
    onChunk: async (stream, chunk) => {
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
      await ctx.onLog(stream, chunk);
    },
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timedOut = true;
    void dockerApiJson({ method: "POST", path: `/containers/${encodeURIComponent(containerId)}/kill` }).catch(() => undefined);
  }, timeoutSec * 1000);

  try {
    await streamPromise;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }
  const exitCode = timedOut ? null : await inspectDockerExec(execId);
  const parsed = parseHermesOutput(stdout, stderr);
  await ctx.onLog("stdout", `[hermes] Exit code: ${exitCode ?? "null"}, timed out: ${timedOut}\n`);
  if (parsed.sessionId) {
    await ctx.onLog("stdout", `[hermes] Session: ${parsed.sessionId}\n`);
  }

  const executionResult: AdapterExecutionResult = {
    exitCode,
    signal: timedOut ? "SIGKILL" : null,
    timedOut,
    provider: provider || null,
    model,
    summary: parsed.response ? parsed.response.slice(0, 2000) : null,
  };
  if (parsed.errorMessage) executionResult.errorMessage = parsed.errorMessage;
  if (parsed.usage) executionResult.usage = parsed.usage;
  if (parsed.costUsd !== undefined) executionResult.costUsd = parsed.costUsd;
  if (persistSession && parsed.sessionId) {
    executionResult.sessionParams = { sessionId: parsed.sessionId };
    executionResult.sessionDisplayId = parsed.sessionId.slice(0, 16);
  }
  return executionResult;
}

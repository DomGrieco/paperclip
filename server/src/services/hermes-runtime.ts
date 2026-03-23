import fs from "node:fs/promises";
import path from "node:path";
import { materializeRuntimeBundleWorkspace, parseObject } from "@paperclipai/adapter-utils/server-utils";
import type { RuntimeBundle } from "@paperclipai/shared";

const RUNTIME_NOTE_MARKER = "Paperclip runtime note:";
const DEFAULT_SHARED_HERMES_HOME_SOURCE = "/paperclip/shared/hermes-home-source";
const SHARED_HERMES_AUTH_FILES = ["auth.json", ".env", "config.yaml"] as const;
const SHARED_CONTEXT_FILE = "shared-context.json";
const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const DEFAULT_ANTHROPIC_MODEL = "anthropic/claude-sonnet-4";

type HermesAuthStore = {
  active_provider?: string;
  provider?: string;
  providers?: Record<string, unknown>;
};

const DEFAULT_HERMES_PAPERCLIP_PROMPT_TEMPLATE = `You are "{{agentName}}", a Hermes worker in a Paperclip-managed company.

${RUNTIME_NOTE_MARKER}
- Use the \`terminal\` tool with \`curl\` for all Paperclip API calls.
- Use \`{{paperclipApiUrl}}\` as the Paperclip API base URL.
- Include \`-H "Authorization: Bearer $PAPER...Y"\` on every Paperclip API request.
- If \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\` is set, read it first with your file tools. The files under \`$PAPERCLIP_RUNTIME_ROOT\` are the Paperclip control-plane source of truth for this run.
- If \`$PAPERCLIP_SHARED_CONTEXT_PATH\` is set, read it as the governed shared context packet before acting.

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

1. Read \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\`, \`$PAPERCLIP_RUNTIME_BUNDLE_PATH\`, and \`$PAPERCLIP_SHARED_CONTEXT_PATH\` before working.
2. Use the runtime bundle plus the current task details as your source of truth.
3. Complete the task using your tools.
4. When done, update the issue status:
   \`curl -s -X PATCH "{{paperclipApiUrl}}/issues/{{taskId}}" -H "Authorization: Bearer $PAPER...KEY" -H "Content-Type: application/json" -d '{"status":"done"}'\`
5. Report what you changed and any evidence/artifacts produced.
{{/taskId}}

{{#noTask}}
## Heartbeat Wake

1. Check your assigned todo issues:
   \`curl -s "{{paperclipApiUrl}}/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}&status=todo" -H "Authorization: Bearer $PAPER...KEY" | python3 -m json.tool\`
2. If an issue is available, pick the highest-priority one, work it, and update its status when complete.
3. If nothing is assigned, exit briefly and clearly.
{{/noTask}}`;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isDefaultLikeModel(model: string | null): boolean {
  return model === null || model === DEFAULT_ANTHROPIC_MODEL || model === "claude-sonnet-4";
}

function defaultModelForProvider(provider: string | null): string | null {
  if (!provider) return null;
  const normalized = provider.toLowerCase();
  if (normalized.includes("openai") || normalized.includes("codex")) return DEFAULT_CODEX_MODEL;
  if (normalized.includes("anthropic") || normalized.includes("claude")) return DEFAULT_ANTHROPIC_MODEL;
  return null;
}

function buildPromptTemplate(existingPromptTemplate: string | null): string {
  if (!existingPromptTemplate) {
    return DEFAULT_HERMES_PAPERCLIP_PROMPT_TEMPLATE;
  }
  if (existingPromptTemplate.includes(RUNTIME_NOTE_MARKER)) {
    return existingPromptTemplate;
  }
  return `${RUNTIME_NOTE_MARKER}
- Use the \`terminal\` tool with \`curl\` for all Paperclip API calls.
- Use \`{{paperclipApiUrl}}\` as the Paperclip API base URL.
- Include \`-H "Authorization: Bearer $PAPER...Y"\` on every Paperclip API request.
- If \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\` is set, read it first with your file tools.
- If \`$PAPERCLIP_SHARED_CONTEXT_PATH\` is set, read it as the governed shared context packet before acting.

${existingPromptTemplate}`;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function readHermesAuthStore(sharedSource: string): Promise<HermesAuthStore | null> {
  const authFile = path.join(sharedSource, "auth.json");
  if (!(await pathExists(authFile))) return null;
  try {
    const raw = await fs.readFile(authFile, "utf8");
    return JSON.parse(raw) as HermesAuthStore;
  } catch {
    return null;
  }
}

async function syncSharedHermesAuthProfile(input: {
  workerHome: string;
  sharedSource: string;
}): Promise<void> {
  await fs.mkdir(input.workerHome, { recursive: true });
  if (!(await pathExists(input.sharedSource))) return;

  for (const relativeName of SHARED_HERMES_AUTH_FILES) {
    const source = path.join(input.sharedSource, relativeName);
    if (!(await pathExists(source))) continue;
    const destination = path.join(input.workerHome, relativeName);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
}

export async function prepareHermesAdapterConfigForExecution(input: {
  config: Record<string, unknown>;
  cwd: string;
  agentHome?: string | null;
  runtimeBundle: RuntimeBundle | null;
  authToken?: string | null;
}): Promise<Record<string, unknown>> {
  const nextConfig: Record<string, unknown> = { ...input.config };
  const env = {
    ...Object.fromEntries(
      Object.entries(parseObject(input.config.env)).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };

  if (!readString(env.PAPERCLIP_API_KEY) && readString(input.authToken)) {
    env.PAPERCLIP_API_KEY = readString(input.authToken)!;
  }

  const workerHome = readString(input.agentHome) ?? path.join(input.cwd, ".paperclip", "hermes-home");
  const sharedSource =
    readString(env.PAPERCLIP_HERMES_SHARED_HOME_SOURCE) ?? DEFAULT_SHARED_HERMES_HOME_SOURCE;
  const authStore = await readHermesAuthStore(sharedSource);
  await syncSharedHermesAuthProfile({ workerHome, sharedSource });
  env.HERMES_HOME = workerHome;

  const currentProvider = readString(input.config.provider);
  const currentModel = readString(input.config.model);
  const activeProvider = readString(authStore?.active_provider) ?? readString(authStore?.provider);

  if (!currentProvider && activeProvider) {
    nextConfig.provider = activeProvider;
  }
  if (isDefaultLikeModel(currentModel)) {
    const providerForDefault = currentProvider ?? activeProvider;
    const defaultModel = defaultModelForProvider(providerForDefault);
    if (defaultModel) {
      nextConfig.model = defaultModel;
    }
  }

  if (input.runtimeBundle) {
    const materialized = await materializeRuntimeBundleWorkspace({
      cwd: input.cwd,
      materializationRoot: input.runtimeBundle.projection.materializationRoot,
      runtimeBundle: input.runtimeBundle,
    });
    if (materialized) {
      env.PAPERCLIP_RUNTIME_ROOT = materialized.root;
      env.PAPERCLIP_RUNTIME_BUNDLE_PATH = materialized.bundlePath;
      env.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH = materialized.instructionsPath;
      env.PAPERCLIP_RUNTIME_BUNDLE_JSON = JSON.stringify(input.runtimeBundle);
      env.PAPERCLIP_MEMORY_RECALL_JSON = JSON.stringify(input.runtimeBundle.memory);

      const sharedContext = {
        companyId: input.runtimeBundle.company.id,
        projectId: input.runtimeBundle.project?.id ?? null,
        issueId: input.runtimeBundle.issue?.id ?? null,
        runId: input.runtimeBundle.run?.id ?? null,
        agentId: input.runtimeBundle.agent.id,
        policy: input.runtimeBundle.policy,
        runner: input.runtimeBundle.runner,
        verification: input.runtimeBundle.verification,
        memory: input.runtimeBundle.memory,
      };
      const sharedContextPath = path.join(path.dirname(materialized.root), "context", SHARED_CONTEXT_FILE);
      await fs.mkdir(path.dirname(sharedContextPath), { recursive: true });
      await fs.writeFile(sharedContextPath, `${JSON.stringify(sharedContext, null, 2)}\n`, "utf8");
      env.PAPERCLIP_SHARED_CONTEXT_PATH = sharedContextPath;
      env.PAPERCLIP_SHARED_CONTEXT_JSON = JSON.stringify(sharedContext);
    }
    if (input.runtimeBundle.issue?.id && readString(input.runtimeBundle.issue.id)) {
      env.PAPERCLIP_ISSUE_ID = input.runtimeBundle.issue.id;
    }
    if (input.runtimeBundle.project?.id && readString(input.runtimeBundle.project.id)) {
      env.PAPERCLIP_PROJECT_ID = input.runtimeBundle.project.id;
    }
  }

  nextConfig.env = env;
  nextConfig.promptTemplate = buildPromptTemplate(readString(input.config.promptTemplate));
  return nextConfig;
}

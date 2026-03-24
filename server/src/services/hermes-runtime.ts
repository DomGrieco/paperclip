import fs from "node:fs/promises";
import path from "node:path";
import { materializeRuntimeBundleWorkspace, parseObject } from "@paperclipai/adapter-utils/server-utils";
import type { HermesBootstrapImportSummary, RuntimeBundle } from "@paperclipai/shared";
import { resolveCompanyHermesHomeDir } from "../home-paths.js";
import { importHermesBootstrapFromHome } from "./hermes-bootstrap.js";
import { buildPaperclipSharedContextPacket } from "./shared-context.js";

const RUNTIME_NOTE_MARKER = "Paperclip runtime note:";
const DEFAULT_SHARED_HERMES_HOME_SOURCE = "/paperclip/shared/hermes-home-source";
const SHARED_HERMES_AUTH_FILES = ["auth.json", ".env", "config.yaml"] as const;
const INLINE_HERMES_BOOTSTRAP_ENV_NAMES = {
  authJson: "PAPERCLIP_HERMES_AUTH_JSON",
  envFile: "PAPERCLIP_HERMES_ENV",
  configYaml: "PAPERCLIP_HERMES_CONFIG_YAML",
  importHome: "PAPERCLIP_HERMES_IMPORT_HOME",
  summaryJson: "PAPERCLIP_HERMES_BOOTSTRAP_SUMMARY_JSON",
} as const;
const SHARED_CONTEXT_FILE = "shared-context.json";
const PAPERCLIP_RUNTIME_ROOT = path.join(".paperclip", "runtime");
const PAPERCLIP_API_HELPER_FILE = "paperclip-api";
const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const DEFAULT_ANTHROPIC_MODEL = "anthropic/claude-sonnet-4";

type HermesAuthStore = {
  active_provider?: string;
  provider?: string;
  providers?: Record<string, unknown>;
};

type InlineHermesBootstrapPayload = {
  authJson: string | null;
  envFile: string | null;
  configYaml: string | null;
};

const DEFAULT_HERMES_PAPERCLIP_PROMPT_TEMPLATE = `You are "{{agentName}}", a Hermes worker in a Paperclip-managed company.

${RUNTIME_NOTE_MARKER}
- For normal Paperclip API calls, use \`$PAPERCLIP_API_HELPER_PATH\` instead of raw \`curl\`. The helper automatically attaches auth headers and prints JSON/text responses.
- Treat raw \`curl\` as last-resort debugging only. Do not use raw \`curl\` for routine issue lookup, status updates, or heartbeat bookkeeping when the helper exists.
- Use \`{{paperclipApiUrl}}\` as the Paperclip API base URL.
- Helper examples:
  - \`$PAPERCLIP_API_HELPER_PATH get /api/health\`
  - \`$PAPERCLIP_API_HELPER_PATH get "/api/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}&status=todo"\`
  - \`$PAPERCLIP_API_HELPER_PATH patch /api/issues/{{taskId}} --json '{"status":"done"}'\`
- If you must fall back to raw HTTP, include \`-H "Authorization: Bearer $PAPERCLIP_API_KEY"\` on every Paperclip API request.
- If \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\` is set, read it first with your file tools. The files under \`$PAPERCLIP_RUNTIME_ROOT\` are the Paperclip control-plane source of truth for this run.
- If \`$PAPERCLIP_SHARED_CONTEXT_PATH\` is set, read it as the governed shared context packet before acting.
- After those files are readable, do not broadly spelunk the environment. Prefer the narrowest path that completes the assigned work and leaves reviewable evidence.
- Do not probe unrelated Paperclip routes or \`/api/health\` unless a specific helper/API call fails and you are gathering evidence for that failure.
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

1. Read \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\`, \`$PAPERCLIP_RUNTIME_BUNDLE_PATH\`, and \`$PAPERCLIP_SHARED_CONTEXT_PATH\` before working.
2. Use the runtime bundle plus the current task details as your source of truth.
3. Complete the task using your tools.
4. When done, update the issue status:
   \`$PAPERCLIP_API_HELPER_PATH patch /api/issues/{{taskId}} --json '{"status":"done"}'\`
5. Report what you changed and any evidence/artifacts produced.
{{/taskId}}

{{#noTask}}
## Heartbeat Wake

1. Check your assigned todo issues:
   \`$PAPERCLIP_API_HELPER_PATH get "/api/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}&status=todo"\`
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
- Use \`$PAPERCLIP_API_HELPER_PATH\` for Paperclip API calls whenever it is available. It automatically attaches auth headers and prints JSON/text responses.
- Only fall back to raw \`curl\` if the helper is unavailable or clearly insufficient.
- Use \`{{paperclipApiUrl}}\` as the Paperclip API base URL.
- If you must fall back to raw HTTP, include \`-H "Authorization: Bearer $PAPERCLIP_API_KEY"\` on every Paperclip API request.
- If \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\` is set, read it first with your file tools.
- If \`$PAPERCLIP_SHARED_CONTEXT_PATH\` is set, read it as the governed shared context packet before acting.
- After those files are readable, do not broadly spelunk the environment. Prefer the narrowest path that completes the assigned work and leaves reviewable evidence.
- Do not probe unrelated Paperclip routes or \`/api/health\` unless a specific helper/API call fails and you are gathering evidence for that failure.
- Aim to finish decisively: restate the objective, perform the smallest useful set of API reads/writes, leave evidence, and stop once the task is complete.

${existingPromptTemplate}

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
   \`$PAPERCLIP_API_HELPER_PATH patch /api/issues/{{taskId}} --json '{"status":"done"}'\`
5. Report what you changed and any evidence/artifacts produced.
{{/taskId}}

{{#noTask}}
## Heartbeat Wake

1. Check your assigned todo issues:
   \`$PAPERCLIP_API_HELPER_PATH get "/api/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}&status=todo"\`
2. If an issue is available, pick the highest-priority one, work it, and update its status when complete.
3. If nothing is assigned, exit briefly and clearly.
{{/noTask}}`;
}

async function materializePaperclipApiHelper(runtimeRoot: string): Promise<string> {
  const helperPath = path.join(runtimeRoot, PAPERCLIP_API_HELPER_FILE);
  const helperSource = `#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: paperclip-api <get|post|patch|put|delete> <path-or-url> [--json <json>]", file=sys.stderr)
        return 2

    method = sys.argv[1].upper()
    target = sys.argv[2]
    api_base = (os.environ.get("PAPERCLIP_API_URL") or "").rstrip("/")
    api_key = os.environ.get("PAPERCLIP_API_KEY") or ""
    run_id = os.environ.get("PAPERCLIP_RUN_ID") or ""
    payload = None

    args = sys.argv[3:]
    if args:
        if len(args) != 2 or args[0] != "--json":
            print("expected optional --json <json>", file=sys.stderr)
            return 2
        payload = args[1]

    url = target if target.startswith("http://") or target.startswith("https://") else f"{api_base}{target}"
    if not url.startswith("http://") and not url.startswith("https://"):
        print("PAPERCLIP_API_URL is not configured and target is not absolute", file=sys.stderr)
        return 2

    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if run_id:
        headers["X-Paperclip-Run-Id"] = run_id

    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = payload.encode("utf-8")

    request = urllib.request.Request(url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
            if body:
                print(body)
            return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if body:
          print(body)
        else:
          print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
`;
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.writeFile(helperPath, helperSource, { encoding: "utf8", mode: 0o755 });
  await fs.chmod(helperPath, 0o755);
  return helperPath;
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

function resolveInlineHermesBootstrapPayload(env: Record<string, string>): InlineHermesBootstrapPayload {
  return {
    authJson: readString(env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.authJson]),
    envFile: readString(env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.envFile]),
    configYaml: readString(env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.configYaml]),
  };
}

function hasInlineHermesBootstrapPayload(payload: InlineHermesBootstrapPayload): boolean {
  return Boolean(payload.authJson || payload.envFile || payload.configYaml);
}

function clearInlineHermesBootstrapEnv(env: Record<string, string>): void {
  delete env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.authJson];
  delete env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.envFile];
  delete env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.configYaml];
}

function clearHermesBootstrapImportHints(env: Record<string, string>): void {
  delete env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.importHome];
}

function setHermesBootstrapSummaryEnv(
  env: Record<string, string>,
  summary: HermesBootstrapImportSummary | null,
): void {
  if (!summary) {
    delete env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.summaryJson];
    return;
  }
  env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.summaryJson] = JSON.stringify(summary);
}

function sanitizeSharedHermesEnvFile(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:export\s+)?TERMINAL_CWD\s*=/.test(line))
    .join("\n")
    .replace(/\n*$/, "\n");
}

function sanitizeSharedHermesConfigYaml(content: string): string {
  const lines = content.split(/\r?\n/);
  const sanitized: string[] = [];
  let inTerminalBlock = false;
  let terminalIndent = -1;

  for (const line of lines) {
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    const trimmed = line.trim();

    if (inTerminalBlock && trimmed.length > 0 && indent <= terminalIndent) {
      inTerminalBlock = false;
      terminalIndent = -1;
    }

    if (!inTerminalBlock && /^terminal\s*:\s*$/.test(trimmed)) {
      inTerminalBlock = true;
      terminalIndent = indent;
      sanitized.push(line);
      continue;
    }

    if (inTerminalBlock && /^cwd\s*:/.test(trimmed)) continue;
    if (inTerminalBlock && /^working_dir\s*:/.test(trimmed)) continue;

    sanitized.push(line);
  }

  return sanitized.join("\n").replace(/\n*$/, "\n");
}

function sanitizeHermesBootstrapFile(input: {
  relativeName: (typeof SHARED_HERMES_AUTH_FILES)[number];
  content: string;
}): string {
  if (input.relativeName === "auth.json") {
    return input.content.replace(/\n*$/, "\n");
  }
  return input.relativeName === ".env"
    ? sanitizeSharedHermesEnvFile(input.content)
    : sanitizeSharedHermesConfigYaml(input.content);
}

async function copySanitizedSharedHermesFile(input: {
  source: string;
  destination: string;
  relativeName: (typeof SHARED_HERMES_AUTH_FILES)[number];
}): Promise<void> {
  const raw = await fs.readFile(input.source, "utf8");
  await fs.writeFile(input.destination, sanitizeHermesBootstrapFile({
    relativeName: input.relativeName,
    content: raw,
  }), "utf8");
}

async function materializeInlineHermesBootstrapProfile(input: {
  workerHome: string;
  payload: InlineHermesBootstrapPayload;
}): Promise<void> {
  await fs.mkdir(input.workerHome, { recursive: true });
  const entries: Array<[(typeof SHARED_HERMES_AUTH_FILES)[number], string | null]> = [
    ["auth.json", input.payload.authJson],
    [".env", input.payload.envFile],
    ["config.yaml", input.payload.configYaml],
  ];

  for (const [relativeName, content] of entries) {
    if (!content) continue;
    const destination = path.join(input.workerHome, relativeName);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, sanitizeHermesBootstrapFile({ relativeName, content }), "utf8");
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
    await copySanitizedSharedHermesFile({ source, destination, relativeName });
  }
}

export async function prepareHermesAdapterConfigForExecution(input: {
  config: Record<string, unknown>;
  cwd: string;
  companyId?: string | null;
  managedHome?: string | null;
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

  const managedHome =
    readString(input.managedHome) ??
    (readString(input.companyId) ? resolveCompanyHermesHomeDir(readString(input.companyId)!) : null) ??
    path.join(input.cwd, ".paperclip", "hermes-home");
  const inlineBootstrap = resolveInlineHermesBootstrapPayload(env);
  const importHome = readString(env[INLINE_HERMES_BOOTSTRAP_ENV_NAMES.importHome]);
  const sharedSource =
    readString(env.PAPERCLIP_HERMES_SHARED_HOME_SOURCE) ?? DEFAULT_SHARED_HERMES_HOME_SOURCE;
  let importedBootstrapSummary: HermesBootstrapImportSummary | null = null;
  if (hasInlineHermesBootstrapPayload(inlineBootstrap)) {
    await materializeInlineHermesBootstrapProfile({ workerHome: managedHome, payload: inlineBootstrap });
  } else if (importHome) {
    const importedBootstrap = await importHermesBootstrapFromHome({ homePath: importHome });
    importedBootstrapSummary = importedBootstrap.summary;
    await materializeInlineHermesBootstrapProfile({
      workerHome: managedHome,
      payload: importedBootstrap.payload,
    });
  } else {
    await syncSharedHermesAuthProfile({ workerHome: managedHome, sharedSource });
  }
  clearInlineHermesBootstrapEnv(env);
  clearHermesBootstrapImportHints(env);
  delete env.PAPERCLIP_HERMES_SHARED_HOME_SOURCE;
  setHermesBootstrapSummaryEnv(env, importedBootstrapSummary);
  const authStore = (await readHermesAuthStore(managedHome)) ?? (managedHome !== sharedSource ? await readHermesAuthStore(sharedSource) : null);
  env.HERMES_HOME = managedHome;
  env.TERMINAL_CWD = input.cwd;

  const currentProvider = readString(input.config.provider);
  const currentModel = readString(input.config.model);
  const activeProvider = readString(authStore?.active_provider) ?? readString(authStore?.provider);
  const bootstrapConfiguredProvider = readString(importedBootstrapSummary?.configuredProvider);
  const bootstrapDefaultModel = readString(importedBootstrapSummary?.defaultModel);

  if (!currentProvider && (activeProvider ?? bootstrapConfiguredProvider)) {
    nextConfig.provider = activeProvider ?? bootstrapConfiguredProvider;
  }
  if (isDefaultLikeModel(currentModel)) {
    if (bootstrapDefaultModel) {
      nextConfig.model = bootstrapDefaultModel;
    } else {
      const providerForDefault = currentProvider ?? activeProvider ?? bootstrapConfiguredProvider;
      const defaultModel = defaultModelForProvider(providerForDefault);
      if (defaultModel) {
        nextConfig.model = defaultModel;
      }
    }
  }

  const helperRuntimeRoot = path.join(input.cwd, PAPERCLIP_RUNTIME_ROOT);
  env.PAPERCLIP_API_HELPER_PATH = await materializePaperclipApiHelper(helperRuntimeRoot);

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
      env.PAPERCLIP_API_HELPER_PATH = await materializePaperclipApiHelper(materialized.root);

      const sharedContextPath = path.join(path.dirname(materialized.root), "context", SHARED_CONTEXT_FILE);
      const sharedContext = buildPaperclipSharedContextPacket({
        runtimeBundle: input.runtimeBundle,
        workspaceCwd: input.cwd,
        runtimeBundleRoot: materialized.root,
        runtimeInstructionsPath: materialized.instructionsPath,
        sharedContextPath,
      });
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

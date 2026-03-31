import fs from "node:fs/promises";
import path from "node:path";
import { ensurePaperclipSkillSymlink, materializeRuntimeBundleWorkspace, parseObject } from "@paperclipai/adapter-utils/server-utils";
import type {
  HermesBootstrapImportSummary,
  PaperclipSharedContextManagedSkill,
  RuntimeBundle,
} from "@paperclipai/shared";
import { resolveCompanyHermesHomeDir } from "../home-paths.js";
import { buildPaperclipApiGovernanceSummary, derivePaperclipApiGovernancePolicy } from "./hermes-governance.js";
import { importHermesBootstrapFromHome, type ImportedHermesBootstrap } from "./hermes-bootstrap.js";
import {
  ensureManagedHermesRuntime,
  type HermesManagedRuntimeResolution,
} from "./hermes-managed-runtime.js";
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
- \`$PAPERCLIP_API_HELPER_PATH\` already uses the configured \`$PAPERCLIP_API_URL\`. Do not re-export or rewrite \`PAPERCLIP_API_URL\` before helper calls.
- \`$PAPERCLIP_API_URL\` points at the Paperclip server root. Keep helper targets as \`/api/...\` paths instead of appending another base prefix yourself.
- Treat raw \`curl\` as last-resort debugging only. Do not use raw \`curl\` for routine issue lookup, status updates, or heartbeat bookkeeping when the helper exists.
- Use \`{{paperclipApiUrl}}\` as the Paperclip API base URL.
- Helper examples:
  - \`$PAPERCLIP_API_HELPER_PATH get /api/health\`
  - \`$PAPERCLIP_API_HELPER_PATH get "/api/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}&status=todo"\`
  - \`$PAPERCLIP_API_HELPER_PATH patch /api/issues/{{taskId}} --json '{"status":"done"}'\`
- If you must fall back to raw HTTP, include \`-H "Authorization: Bearer $PAPER...Y"\` on every Paperclip API request.
- If \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\` is set, read it first with your file tools. The files under \`$PAPERCLIP_RUNTIME_ROOT\` are the Paperclip control-plane source of truth for this run.
- If \`$PAPERCLIP_SHARED_CONTEXT_PATH\` is set, read it as the governed shared context packet before acting.
- Limit your initial file reads to \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\`, \`$PAPERCLIP_RUNTIME_BUNDLE_PATH\`, and \`$PAPERCLIP_SHARED_CONTEXT_PATH\`. Do not expand into \`policy.json\`, \`runner.json\`, \`verification.json\`, broad file discovery, or repeated re-reads unless the task explicitly requires it or those files point you there.
- After those files are readable, do not broadly spelunk the environment. Prefer the narrowest path that completes the assigned work and leaves reviewable evidence.
- Do not probe unrelated Paperclip routes or \`/api/health\` unless a specific helper/API call fails and you are gathering evidence for that failure.
- If a helper call fails, record that exact failure and stop to reassess. Do not pivot into host/IP probing, ad-hoc Python HTTP scripts, or broad environment scans.
- If \`$PAPERCLIP_API_POLICY_SUMMARY\` is set, treat it as the exact helper allowlist contract for this run. Do not call helper endpoints outside that contract.
- In an already-running assigned issue execution, do not call \`/api/agents/{{agentId}}/wakeup\` to \"start\" yourself again unless the task explicitly asks you to validate wakeup semantics.
- Do not try to prove that prohibition by attempting the wakeup call anyway. Treat \`/api/agents/{{agentId}}/wakeup\`, top-level \`/api/runs\`, bare \`/api\`, and other broad discovery endpoints as forbidden unless the task explicitly requires them.
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

function appendWorkerResultContract(promptTemplate: string, runtimeBundle: RuntimeBundle | null | undefined): string {
  const runType = readString(runtimeBundle?.run?.runType);
  const currentSubtask = parseObject(runtimeBundle?.swarm?.currentSubtask);
  if (runType !== "worker" || !currentSubtask) return promptTemplate;

  const taskKey = readString(currentSubtask.taskKey) ?? readString(currentSubtask.id) ?? "worker-subtask";
  const expectedArtifacts = Array.isArray(currentSubtask.expectedArtifacts)
    ? JSON.stringify(currentSubtask.expectedArtifacts)
    : "[]";
  const acceptanceChecks = Array.isArray(currentSubtask.acceptanceChecks)
    ? JSON.stringify(currentSubtask.acceptanceChecks)
    : "[]";
  return `${promptTemplate}

## Worker completion contract
- This run is a swarm worker for subtask \`${taskKey}\`.
- Required expected artifacts for this subtask: ${expectedArtifacts}
- Acceptance checks for this subtask: ${acceptanceChecks}
- Before finishing, emit exactly one final machine-readable block in your final response using this format:
  PAPERCLIP_RESULT_JSON_START
  {"childOutput":{"summary":"concise evidence-backed summary of what was completed","status":"completed","notes":["optional concrete note"],"artifactClaims":[{"kind":"summary","label":"optional human-readable label","detail":"optional location or evidence detail"}]}}
  PAPERCLIP_RESULT_JSON_END
- Use valid JSON only inside that block. No markdown fences, comments, or trailing prose inside the block.
- Allowed child output status values are exactly \`completed\` or \`blocked\`.
- The \`summary\` field is required and must be non-empty.
- The \`artifactClaims\` list must name the concrete artifact kinds you actually produced for this subtask. Allowed artifact kinds are exactly: \`summary\`, \`patch\`, \`test_result\`, \`comment\`, \`document\`.
- Match your artifact claims to the subtask's expected artifacts. If the task is validation-only, still emit a structured block describing the concrete evidence you produced.
- Put any longer human-readable explanation outside the JSON block.`;
}

function buildPromptTemplate(existingPromptTemplate: string | null, runtimeBundle: RuntimeBundle | null | undefined): string {
  const basePrompt = !existingPromptTemplate
    ? DEFAULT_HERMES_PAPERCLIP_PROMPT_TEMPLATE
    : existingPromptTemplate.includes(RUNTIME_NOTE_MARKER)
      ? existingPromptTemplate
      : `${RUNTIME_NOTE_MARKER}
- Use \`$PAPERCLIP_API_HELPER_PATH\` for Paperclip API calls whenever it is available. It automatically attaches auth headers and prints JSON/text responses.
- \`$PAPERCLIP_API_HELPER_PATH\` already uses the configured \`$PAPERCLIP_API_URL\`. Do not re-export or rewrite \`PAPERCLIP_API_URL\` before helper calls.
- \`$PAPERCLIP_API_URL\` points at the Paperclip server root. Keep helper targets as \`/api/...\` paths instead of appending another base prefix yourself.
- Only fall back to raw \`curl\` if the helper is unavailable or clearly insufficient.
- Use \`{{paperclipApiUrl}}\` as the Paperclip API base URL.
- If you must fall back to raw HTTP, include \`-H "Authorization: Bearer *** on every Paperclip API request.
- If \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\` is set, read it first with your file tools. The files under \`$PAPERCLIP_RUNTIME_ROOT\` are the Paperclip control-plane source of truth for this run.
- If \`$PAPERCLIP_SHARED_CONTEXT_PATH\` is set, read it as the governed shared context packet before acting.
- Limit your initial file reads to \`$PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH\`, \`$PAPERCLIP_RUNTIME_BUNDLE_PATH\`, and \`$PAPERCLIP_SHARED_CONTEXT_PATH\`. Do not expand into \`policy.json\`, \`runner.json\`, \`verification.json\`, broad file discovery, or repeated re-reads unless the task explicitly requires it or those files point you there.
- After those files are readable, do not broadly spelunk the environment. Prefer the narrowest path that completes the assigned work and leaves reviewable evidence.
- Do not probe unrelated Paperclip routes or \`/api/health\` unless a specific helper/API call fails and you are gathering evidence for that failure.
- If a helper call fails, record that exact failure and stop to reassess. Do not pivot into host/IP probing, ad-hoc Python HTTP scripts, or broad environment scans.
- If \`$PAPERCLIP_API_POLICY_SUMMARY\` is set, treat it as the exact helper allowlist contract for this run. Do not call helper endpoints outside that contract.
- In an already-running assigned issue execution, do not call \`/api/agents/{{agentId}}/wakeup\` to \"start\" yourself again unless the task explicitly asks you to validate wakeup semantics.
- Do not try to prove that prohibition by attempting the wakeup call anyway. Treat \`/api/agents/{{agentId}}/wakeup\`, top-level \`/api/runs\`, bare \`/api\`, and other broad discovery endpoints as forbidden unless the task explicitly requires them.
- Avoid repeated status polling of the same issue/agent/run endpoints. Fetch what you need once, act, then do at most one final confirmation read.
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

  return appendWorkerResultContract(basePrompt, runtimeBundle);
}

async function materializePaperclipApiHelper(runtimeRoot: string): Promise<string> {
  const helperPath = path.join(runtimeRoot, PAPERCLIP_API_HELPER_FILE);
  const helperSource = `#!/usr/bin/env python3
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def load_state(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_state(path: str, state: dict) -> None:
    try:
        pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except Exception:
        pass


def normalize_target(api_base: str, target: str) -> tuple[str, str]:
    url = target if target.startswith("http://") or target.startswith("https://") else f"{api_base}{target}"
    parsed = urllib.parse.urlparse(url)
    path = parsed.path or "/"
    query = f"?{parsed.query}" if parsed.query else ""
    return url, f"{path}{query}"


def load_policy() -> dict:
    raw = os.environ.get("PAPERCLIP_API_POLICY_JSON") or ""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def guard_policy_request(method: str, path_only: str, state_path: str) -> str | None:
    policy = load_policy()
    if not policy:
        return None

    allowed = policy.get("allowedRequests")
    if not isinstance(allowed, list):
        return None

    matched_rule = None
    matched_key = None
    for rule in allowed:
        if not isinstance(rule, dict):
            continue
        rule_method = str(rule.get("method") or "").upper()
        pattern = str(rule.get("pathPattern") or "")
        if rule_method != method or not pattern:
            continue
        try:
            if re.fullmatch(pattern, path_only):
                matched_rule = rule
                matched_key = f"{rule_method} {pattern}"
                break
        except re.error:
            continue

    if matched_rule is None or matched_key is None:
        return f"request not allowed by governed helper policy: {method} {path_only}"

    state = load_state(state_path)
    policy_counts = state.get("policy_counts")
    if not isinstance(policy_counts, dict):
        policy_counts = {}
        state["policy_counts"] = policy_counts

    count = int(policy_counts.get(matched_key) or 0) + 1
    policy_counts[matched_key] = count
    save_state(state_path, state)

    max_calls = int(matched_rule.get("maxCalls") or 0)
    if max_calls > 0 and count > max_calls:
        return f"request exceeds governed helper policy budget: {method} {path_only}"
    return None


def guard_request(method: str, normalized_target: str, state_path: str) -> str | None:
    issue_id = os.environ.get("PAPERCLIP_ISSUE_ID") or ""
    if not issue_id:
        return None

    path_only = normalized_target.split("?", 1)[0]
    policy_error = guard_policy_request(method, path_only, state_path)
    if policy_error:
        return policy_error
    if path_only == "/api" or path_only == "/api/runs" or path_only.startswith("/api/runs/"):
        return f"forbidden broad discovery endpoint during assigned issue execution: {path_only}"
    if path_only.startswith("/api/agents/") and path_only.endswith("/wakeup"):
        return f"forbidden wakeup endpoint during assigned issue execution: {path_only}"
    if path_only.startswith(f"/api/issues/{issue_id}/") and method == "POST" and not path_only.endswith("/comments"):
        return f"forbidden issue-subresource POST during assigned issue execution: {path_only}"

    state = load_state(state_path)
    if method == "GET":
        counts = state.get("get_counts")
        if not isinstance(counts, dict):
            counts = {}
            state["get_counts"] = counts
        count = int(counts.get(normalized_target) or 0) + 1
        counts[normalized_target] = count
        save_state(state_path, state)
        if count > 2:
            return f"forbidden repeated GET during assigned issue execution: {normalized_target}"
    return None


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] in {"-h", "--help"}:
        print("usage: paperclip-api <get|post|patch|put|delete> <path-or-url> [--json <json>]")
        return 0
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

    url, normalized_target = normalize_target(api_base, target)
    if not url.startswith("http://") and not url.startswith("https://"):
        print("PAPERCLIP_API_URL is not configured and target is not absolute", file=sys.stderr)
        return 2

    state_path = os.environ.get("PAPERCLIP_API_HELPER_STATE_PATH") or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".paperclip-api-state.json")
    guard_error = guard_request(method, normalized_target, state_path)
    if guard_error:
        print(guard_error, file=sys.stderr)
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

async function clearStalePaperclipRuntimeArtifacts(cwd: string): Promise<void> {
  const runtimeRoot = path.join(cwd, PAPERCLIP_RUNTIME_ROOT);
  const sharedContextRoot = path.join(cwd, ".paperclip", "context");
  await Promise.all([
    fs.rm(runtimeRoot, { recursive: true, force: true }),
    fs.rm(path.join(sharedContextRoot, SHARED_CONTEXT_FILE), { force: true }),
  ]);
}

async function syncManagedSkillsIntoHermesHome(input: {
  managedHome: string;
  managedSkillsDir: string | null;
  managedSkills: PaperclipSharedContextManagedSkill[];
}): Promise<void> {
  const skillsHome = path.join(input.managedHome, "skills");
  await fs.mkdir(skillsHome, { recursive: true });
  const allowedSkillNames = new Set(input.managedSkills.map((skill) => skill.name));
  const entries = await fs.readdir(skillsHome, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (allowedSkillNames.has(entry.name)) continue;
    const target = path.join(skillsHome, entry.name);
    const existing = await fs.lstat(target).catch(() => null);
    if (!existing?.isSymbolicLink()) continue;
    const linkedPath = await fs.readlink(target).catch(() => null);
    if (!linkedPath) continue;
    const resolvedLinkedPath = path.isAbsolute(linkedPath)
      ? linkedPath
      : path.resolve(path.dirname(target), linkedPath);
    if (!resolvedLinkedPath.includes(`${path.sep}.paperclip${path.sep}runtime${path.sep}skills${path.sep}`)) {
      continue;
    }
    await fs.unlink(target);
  }

  if (!input.managedSkillsDir) {
    return;
  }

  for (const skill of input.managedSkills) {
    const source = path.join(input.managedSkillsDir, skill.name);
    const target = path.join(skillsHome, skill.name);
    const sourceExists = await pathExists(source);
    if (!sourceExists) continue;
    await ensurePaperclipSkillSymlink(source, target);
  }
}

export async function prepareHermesAdapterConfigForExecution(input: {
  config: Record<string, unknown>;
  cwd: string;
  companyId?: string | null;
  managedHome?: string | null;
  runtimeBundle: RuntimeBundle | null;
  managedSkillsDir?: string | null;
  managedSkills?: PaperclipSharedContextManagedSkill[] | null;
  authToken?: string | null;
  persistedBootstrap?: ImportedHermesBootstrap | null;
  managedRuntime?: HermesManagedRuntimeResolution | null;
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
  } else if (input.persistedBootstrap) {
    importedBootstrapSummary = input.persistedBootstrap.summary;
    await materializeInlineHermesBootstrapProfile({
      workerHome: managedHome,
      payload: input.persistedBootstrap.payload,
    });
  } else {
    await syncSharedHermesAuthProfile({ workerHome: managedHome, sharedSource });
  }
  clearInlineHermesBootstrapEnv(env);
  clearHermesBootstrapImportHints(env);
  delete env.PAPERCLIP_HERMES_SHARED_HOME_SOURCE;
  setHermesBootstrapSummaryEnv(env, importedBootstrapSummary);
  const authStore = (await readHermesAuthStore(managedHome)) ?? (managedHome !== sharedSource ? await readHermesAuthStore(sharedSource) : null);
  await syncManagedSkillsIntoHermesHome({
    managedHome,
    managedSkillsDir: input.managedSkillsDir ?? null,
    managedSkills: input.managedSkills ?? [],
  });
  env.HERMES_HOME = managedHome;
  env.TERMINAL_CWD = input.cwd;
  if (input.managedSkillsDir) {
    env.PAPERCLIP_SKILLS_DIR = input.managedSkillsDir;
  }

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

  const managedRuntime =
    input.managedRuntime ??
    (readString(input.config.hermesCommand)
      ? null
      : await ensureManagedHermesRuntime({ config: input.config }));

  if (managedRuntime) {
    nextConfig.hermesCommand = managedRuntime.hermesCommand;
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_ROOT = managedRuntime.installRoot;
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_HERMES_COMMAND = managedRuntime.hermesCommand;
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_PYTHON_COMMAND = managedRuntime.pythonCommand;
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_VERSION = managedRuntime.version;
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_CHANNEL = managedRuntime.channel;
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_SOURCE = managedRuntime.source;
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_UPDATED_AT = managedRuntime.updatedAt;
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_CHECKED_AT = managedRuntime.checkedAt;
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_REFRESHED = managedRuntime.refreshed ? "true" : "false";
    env.PAPERCLIP_HERMES_MANAGED_RUNTIME_METADATA_JSON = JSON.stringify({
      channel: managedRuntime.channel,
      source: managedRuntime.source,
      installRoot: managedRuntime.installRoot,
      hermesCommand: managedRuntime.hermesCommand,
      pythonCommand: managedRuntime.pythonCommand,
      version: managedRuntime.version,
      checkedAt: managedRuntime.checkedAt,
      updatedAt: managedRuntime.updatedAt,
      refreshed: managedRuntime.refreshed,
    });
  }

  if (!input.runtimeBundle) {
    await clearStalePaperclipRuntimeArtifacts(input.cwd);
  }

  const helperRuntimeRoot = path.join(input.cwd, PAPERCLIP_RUNTIME_ROOT);
  env.PAPERCLIP_API_HELPER_PATH = await materializePaperclipApiHelper(helperRuntimeRoot);
  env.PAPERCLIP_API_HELPER_STATE_PATH = path.join(helperRuntimeRoot, ".paperclip-api-state.json");

  if (input.runtimeBundle) {
    const issueDescriptionSnippet = Array.isArray(input.runtimeBundle.memory?.snippets)
      ? input.runtimeBundle.memory.snippets.find((snippet) => snippet?.source === "issue.description")
      : null;
    const governancePolicy = derivePaperclipApiGovernancePolicy({
      taskId: readString(input.runtimeBundle.issue?.id),
      agentId: readString(input.runtimeBundle.agent?.id),
      taskTitle: readString(input.runtimeBundle.issue?.title),
      taskBody: typeof issueDescriptionSnippet?.content === "string" ? issueDescriptionSnippet.content : null,
    });
    const governanceSummary = buildPaperclipApiGovernanceSummary(governancePolicy);
    if (governancePolicy) {
      env.PAPERCLIP_API_POLICY_JSON = JSON.stringify(governancePolicy);
    }
    if (governanceSummary) {
      env.PAPERCLIP_API_POLICY_SUMMARY = governanceSummary;
    }

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
      env.PAPERCLIP_API_HELPER_STATE_PATH = path.join(materialized.root, ".paperclip-api-state.json");

      const sharedContextPath = path.join(path.dirname(materialized.root), "context", SHARED_CONTEXT_FILE);
      const sharedContext = buildPaperclipSharedContextPacket({
        runtimeBundle: input.runtimeBundle,
        workspaceCwd: input.cwd,
        runtimeBundleRoot: materialized.root,
        runtimeInstructionsPath: materialized.instructionsPath,
        sharedContextPath,
        managedSkillsDir: input.managedSkillsDir ?? null,
        managedSkills: input.managedSkills ?? [],
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
  nextConfig.promptTemplate = buildPromptTemplate(readString(input.config.promptTemplate), input.runtimeBundle);
  return nextConfig;
}

import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "@paperclipai/adapter-codex-local/server";

async function writeFakeCodexCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const bundlePath = process.env.PAPERCLIP_RUNTIME_BUNDLE_PATH || null;
const runtimeRoot = process.env.PAPERCLIP_RUNTIME_ROOT || null;
const instructionsPath = process.env.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH || null;
const payload = {
  argv: process.argv.slice(2),
  prompt: fs.readFileSync(0, "utf8"),
  codexHome: process.env.CODEX_HOME || null,
  runtimeRoot,
  bundlePath,
  instructionsPath,
  instructionsMarkdown: instructionsPath ? fs.readFileSync(instructionsPath, "utf8") : null,
  bundleJson: bundlePath ? JSON.parse(fs.readFileSync(bundlePath, "utf8")) : null,
  policyJson: runtimeRoot ? JSON.parse(fs.readFileSync(require("node:path").join(runtimeRoot, "policy.json"), "utf8")) : null,
  paperclipEnvKeys: Object.keys(process.env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort(),
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-session-1" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

async function writeFlakyCodexCommand(commandPath: string, attemptsPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const attemptsPath = process.env.PAPERCLIP_TEST_ATTEMPTS_PATH;
const attempt = attemptsPath && fs.existsSync(attemptsPath)
  ? Number.parseInt(fs.readFileSync(attemptsPath, "utf8"), 10) || 0
  : 0;
const nextAttempt = attempt + 1;
if (attemptsPath) {
  fs.writeFileSync(attemptsPath, String(nextAttempt), "utf8");
}
if (nextAttempt === 1) {
  console.error("2026-04-01T03:32:01.115387Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 500 Internal Server Error, url: wss://api.openai.com/v1/responses");
  process.exit(1);
}
console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-session-retry" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello after retry" } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

type CapturePayload = {
  argv: string[];
  prompt: string;
  codexHome: string | null;
  runtimeRoot: string | null;
  bundlePath: string | null;
  instructionsPath: string | null;
  instructionsMarkdown: string | null;
  bundleJson: Record<string, unknown> | null;
  policyJson: Record<string, unknown> | null;
  paperclipEnvKeys: string[];
};

type LogEntry = {
  stream: "stdout" | "stderr";
  chunk: string;
};

describe("codex execute", () => {
  it("uses a worktree-isolated CODEX_HOME while preserving shared auth and config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const paperclipHome = path.join(root, "paperclip-home");
    const isolatedCodexHome = path.join(paperclipHome, "instances", "worktree-1", "codex-home");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}\n', "utf8");
    await fs.writeFile(path.join(sharedCodexHome, "config.toml"), 'model = "codex-mini-latest"\n', "utf8");
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousPaperclipHome = process.env.PAPERCLIP_HOME;
    const previousPaperclipInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
    const previousPaperclipInWorktree = process.env.PAPERCLIP_IN_WORKTREE;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = root;
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "worktree-1";
    process.env.PAPERCLIP_IN_WORKTREE = "true";
    process.env.CODEX_HOME = sharedCodexHome;

    try {
      const logs: LogEntry[] = [];
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {
          paperclipRuntimeBundle: {
            runtime: "codex",
            company: { id: "company-1" },
            agent: { id: "agent-1", name: "Codex Coder", adapterType: "codex_local" },
            project: null,
            issue: { id: "issue-1", identifier: "TST-1", title: "Materialize runtime bundle", status: "in_progress", priority: "high" },
            run: { id: "run-1", runType: "worker", rootRunId: "run-0", parentRunId: "run-0", graphDepth: 1, repairAttempt: 0, verificationVerdict: null },
            policy: { tddMode: "required", evidencePolicy: "code_ci_evaluator_summary", evidencePolicySource: "company_default", maxRepairAttempts: 3, requiresHumanArtifacts: false },
            runner: { target: "local_host", provider: "local_process", workspaceStrategyType: null, executionMode: null, browserCapable: false, sandboxed: false, isolationBoundary: "host_process" },
            verification: { required: true, requiresEvaluatorSummary: true, requiresArtifacts: false, latestVerificationRunId: null, reviewReadyAt: null, runner: { target: "local_host", provider: "local_process", workspaceStrategyType: null, executionMode: null, browserCapable: false, sandboxed: false, isolationBoundary: "host_process" } },
            memory: { snippets: [{ scope: "issue", source: "issue.description", content: "Use the runtime bundle files." }] },
            projection: { runtime: "codex", contextKey: "paperclipRuntimeBundle", envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON", materializationRoot: ".paperclip/runtime" },
          },
          paperclipRuntimeProjection: { runtime: "codex", contextKey: "paperclipRuntimeBundle", envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON", materializationRoot: ".paperclip/runtime" },
        },
        authToken: "run-jwt-token",
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.codexHome).toBe(isolatedCodexHome);
      expect(capture.argv).toEqual(expect.arrayContaining(["exec", "--json", "-"]));
      expect(capture.prompt).toContain("Follow the paperclip heartbeat.");
      expect(capture.paperclipEnvKeys).toEqual(
        expect.arrayContaining([
          "PAPERCLIP_AGENT_ID",
          "PAPERCLIP_API_KEY",
          "PAPERCLIP_API_URL",
          "PAPERCLIP_COMPANY_ID",
          "PAPERCLIP_RUN_ID",
          "PAPERCLIP_RUNTIME_BUNDLE_PATH",
          "PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH",
          "PAPERCLIP_RUNTIME_ROOT",
        ]),
      );
      expect(capture.runtimeRoot).toBe(path.join(workspace, ".paperclip", "runtime"));
      expect(capture.bundlePath).toBe(path.join(workspace, ".paperclip", "runtime", "bundle.json"));
      expect(capture.instructionsPath).toBe(path.join(workspace, ".paperclip", "runtime", "instructions.md"));
      expect(capture.instructionsMarkdown).toContain("# Paperclip codex runtime projection");
      expect(capture.instructionsMarkdown).toContain("Materialize runtime bundle");
      expect(capture.bundleJson?.runtime).toBe("codex");
      expect(capture.policyJson?.evidencePolicy).toBe("code_ci_evaluator_summary");

      const isolatedAuth = path.join(isolatedCodexHome, "auth.json");
      const isolatedConfig = path.join(isolatedCodexHome, "config.toml");
      const isolatedSkill = path.join(isolatedCodexHome, "skills", "paperclip");

      expect((await fs.lstat(isolatedAuth)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(isolatedAuth)).toBe(await fs.realpath(path.join(sharedCodexHome, "auth.json")));
      expect((await fs.lstat(isolatedConfig)).isFile()).toBe(true);
      expect(await fs.readFile(isolatedConfig, "utf8")).toBe('model = "codex-mini-latest"\n');
      expect((await fs.lstat(isolatedSkill)).isSymbolicLink()).toBe(true);
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stdout",
          chunk: expect.stringContaining("Using worktree-isolated Codex home"),
        }),
      );
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stdout",
          chunk: expect.stringContaining('Injected Codex skill "paperclip"'),
        }),
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousPaperclipHome;
      if (previousPaperclipInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
      else process.env.PAPERCLIP_INSTANCE_ID = previousPaperclipInstanceId;
      if (previousPaperclipInWorktree === undefined) delete process.env.PAPERCLIP_IN_WORKTREE;
      else process.env.PAPERCLIP_IN_WORKTREE = previousPaperclipInWorktree;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("respects an explicit CODEX_HOME config override even in worktree mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-explicit-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const explicitCodexHome = path.join(root, "explicit-codex-home");
    const paperclipHome = path.join(root, "paperclip-home");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token": "***"}\n', "utf8");
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousPaperclipHome = process.env.PAPERCLIP_HOME;
    const previousPaperclipInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
    const previousPaperclipInWorktree = process.env.PAPERCLIP_IN_WORKTREE;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = root;
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "worktree-1";
    process.env.PAPERCLIP_IN_WORKTREE = "true";
    process.env.CODEX_HOME = sharedCodexHome;

    try {
      const result = await execute({
        runId: "run-2",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
            CODEX_HOME: explicitCodexHome,
            PAPERCLIP_CODEX_SHARED_HOME_SOURCE: sharedCodexHome,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.codexHome).toBe(explicitCodexHome);
      await expect(fs.lstat(path.join(paperclipHome, "instances", "worktree-1", "codex-home"))).rejects.toThrow();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousPaperclipHome;
      if (previousPaperclipInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
      else process.env.PAPERCLIP_INSTANCE_ID = previousPaperclipInstanceId;
      if (previousPaperclipInWorktree === undefined) delete process.env.PAPERCLIP_IN_WORKTREE;
      else process.env.PAPERCLIP_IN_WORKTREE = previousPaperclipInWorktree;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("retries once when codex hits a transient websocket 500 error", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-retry-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const attemptsPath = path.join(root, "attempts.txt");
    await fs.mkdir(workspace, { recursive: true });
    await writeFlakyCodexCommand(commandPath, attemptsPath);

    try {
      const logs: LogEntry[] = [];
      const result = await execute({
        runId: "run-3",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_ATTEMPTS_PATH: attemptsPath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();
      expect(result.summary).toBe("hello after retry");
      expect(await fs.readFile(attemptsPath, "utf8")).toBe("2");
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stderr",
          chunk: expect.stringContaining("transient upstream server error; retrying once"),
        }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

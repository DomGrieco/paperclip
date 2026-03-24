import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeBundle } from "@paperclipai/shared";
import { prepareHermesAdapterConfigForExecution } from "../services/hermes-runtime.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-runtime-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeBundle(): RuntimeBundle {
  return {
    runtime: "hermes",
    company: { id: "company-1" },
    agent: { id: "agent-1", name: "Hermes Engineer", adapterType: "hermes_local" },
    project: { id: "project-1", name: "Paperclip", executionWorkspacePolicy: null },
    issue: { id: "issue-1", identifier: "DMG-5", title: "Add Hermes runtime bundle", status: "todo", priority: "high" },
    run: {
      id: "run-1",
      runType: "worker",
      rootRunId: "run-1",
      parentRunId: null,
      graphDepth: 0,
      repairAttempt: 0,
      verificationVerdict: null,
    },
    policy: {
      tddMode: "required",
      evidencePolicy: "code_ci_evaluator_summary",
      evidencePolicySource: "issue_override",
      maxRepairAttempts: 3,
      requiresHumanArtifacts: false,
    },
    runner: {
      target: "local_host",
      provider: "local_process",
      workspaceStrategyType: "git_worktree",
      executionMode: "isolated_workspace",
      browserCapable: false,
      sandboxed: false,
      isolationBoundary: "host_process",
    },
    verification: {
      required: true,
      requiresEvaluatorSummary: true,
      requiresArtifacts: false,
      latestVerificationRunId: null,
      reviewReadyAt: null,
      runner: {
        target: "local_host",
        provider: "local_process",
        workspaceStrategyType: "git_worktree",
        executionMode: "isolated_workspace",
        browserCapable: false,
        sandboxed: false,
        isolationBoundary: "host_process",
      },
    },
    memory: {
      snippets: [
        {
          scope: "issue",
          source: "issue.description",
          sourceId: "issue-1",
          content: "Implement the Hermes runtime bundle contract.",
          freshness: "static",
          updatedAt: new Date().toISOString(),
          rank: 1,
        },
      ],
    },
    projection: {
      runtime: "hermes",
      contextKey: "paperclipRuntimeBundle",
      envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON",
      materializationRoot: ".paperclip/runtime",
    },
  };
}

describe("prepareHermesAdapterConfigForExecution", () => {
  it("injects Paperclip auth/runtime env and materializes runtime files for Hermes", async () => {
    const cwd = await makeTempDir();
    const sharedSource = await makeTempDir();
    await fs.writeFile(
      path.join(sharedSource, "auth.json"),
      JSON.stringify({ active_provider: "openai-codex" }) + "\n",
      "utf8",
    );
    await fs.writeFile(path.join(sharedSource, ".env"), "OPENAI_API_KEY=test-key\nTERMINAL_CWD=/Users/eru\n", "utf8");
    await fs.writeFile(
      path.join(sharedSource, "config.yaml"),
      [
        "model: gpt-5.3-codex",
        "terminal:",
        "  cwd: /Users/eru",
        "  working_dir: /Users/eru",
        "  timeout: 300",
        "",
      ].join("\n"),
      "utf8",
    );
    const nextConfig = await prepareHermesAdapterConfigForExecution({
      config: {
        model: "anthropic/claude-sonnet-4",
        env: { PAPERCLIP_HERMES_SHARED_HOME_SOURCE: sharedSource },
      },
      cwd,
      companyId: "company-1",
      managedHome: path.join(cwd, "company-hermes-home"),
      runtimeBundle: makeBundle(),
      authToken: "jwt-token-123",
    });

    const env = nextConfig.env as Record<string, string>;
    expect(env.PAPERCLIP_API_KEY).toBe("jwt-token-123");
    expect(env.PAPERCLIP_RUNTIME_ROOT).toContain(path.join(".paperclip", "runtime"));
    expect(env.PAPERCLIP_RUNTIME_BUNDLE_PATH).toContain(path.join(".paperclip", "runtime", "bundle.json"));
    expect(env.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH).toContain(path.join(".paperclip", "runtime", "instructions.md"));
    expect(env.PAPERCLIP_API_HELPER_PATH).toContain(path.join(".paperclip", "runtime", "paperclip-api"));
    expect(env.PAPERCLIP_ISSUE_ID).toBe("issue-1");
    expect(env.PAPERCLIP_PROJECT_ID).toBe("project-1");
    expect(env.PAPERCLIP_SHARED_CONTEXT_PATH).toContain(path.join(".paperclip", "context", "shared-context.json"));
    expect(env.PAPERCLIP_SHARED_CONTEXT_JSON).toContain("\"version\":\"v1\"");
    expect(env.PAPERCLIP_SHARED_CONTEXT_JSON).toContain("\"issueId\":\"issue-1\"");
    expect(env.HERMES_HOME).toContain(path.join("company-hermes-home"));
    expect(env.PAPERCLIP_HERMES_SHARED_HOME_SOURCE).toBeUndefined();

    const bundleJson = await fs.readFile(env.PAPERCLIP_RUNTIME_BUNDLE_PATH, "utf8");
    expect(bundleJson).toContain('"runtime": "hermes"');

    const instructions = await fs.readFile(env.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH, "utf8");
    expect(instructions).toContain("Paperclip hermes runtime projection");
    expect(instructions).toContain("Do not spend the run broadly spelunking the environment");
    expect(instructions).toContain("Prefer the narrowest path that completes the assigned work");

    const helper = await fs.readFile(env.PAPERCLIP_API_HELPER_PATH, "utf8");
    expect(helper).toContain("urllib.request");
    expect(helper).toContain("PAPERCLIP_API_URL");

    const sharedContext = JSON.parse(await fs.readFile(env.PAPERCLIP_SHARED_CONTEXT_PATH, "utf8")) as {
      version: string;
      scope: {
        companyId: string;
        issueId: string | null;
        runId: string | null;
      };
      provenance: {
        source: string;
        workspaceCwd: string;
      };
      memory: RuntimeBundle["memory"];
    };
    expect(sharedContext.version).toBe("v1");
    expect(sharedContext.scope.companyId).toBe("company-1");
    expect(sharedContext.scope.issueId).toBe("issue-1");
    expect(sharedContext.scope.runId).toBe("run-1");
    expect(sharedContext.provenance.source).toBe("runtime_bundle");
    expect(sharedContext.provenance.workspaceCwd).toBe(cwd);
    expect(sharedContext.memory.snippets).toHaveLength(1);

    const copiedAuth = await fs.readFile(path.join(env.HERMES_HOME, "auth.json"), "utf8");
    const copiedEnv = await fs.readFile(path.join(env.HERMES_HOME, ".env"), "utf8");
    const copiedConfig = await fs.readFile(path.join(env.HERMES_HOME, "config.yaml"), "utf8");

    expect(copiedAuth).toContain("openai-codex");
    expect(copiedEnv).toContain("OPENAI_API_KEY=test-key");
    expect(copiedEnv).not.toContain("TERMINAL_CWD=/Users/eru");
    expect(copiedConfig).toContain("terminal:");
    expect(copiedConfig).toContain("timeout: 300");
    expect(copiedConfig).not.toContain("cwd: /Users/eru");
    expect(copiedConfig).not.toContain("working_dir: /Users/eru");
    expect(env.TERMINAL_CWD).toBe(cwd);

    expect(String(nextConfig.promptTemplate)).toContain("Paperclip runtime note:");
    expect(String(nextConfig.promptTemplate)).toContain("shared context packet");
    expect(String(nextConfig.promptTemplate)).toContain("PAPERCLIP_API_HELPER_PATH");
    expect(String(nextConfig.promptTemplate)).toContain("Treat raw `curl` as last-resort debugging only");
    expect(String(nextConfig.promptTemplate)).toContain("do not broadly spelunk the environment");
    expect(String(nextConfig.promptTemplate)).toContain("finish decisively");
    expect(nextConfig.provider).toBe("openai-codex");
    expect(nextConfig.model).toBe("gpt-5.3-codex");
  });

  it("materializes inline managed bootstrap payloads without leaking bootstrap env hints", async () => {
    const cwd = await makeTempDir();
    const nextConfig = await prepareHermesAdapterConfigForExecution({
      config: {
        model: "anthropic/claude-sonnet-4",
        env: {
          PAPERCLIP_HERMES_AUTH_JSON: JSON.stringify({ active_provider: "openai-codex" }),
          PAPERCLIP_HERMES_ENV: ["OPENAI_API_KEY=inline-key", "TERMINAL_CWD=/tmp/host-cwd", ""].join("\n"),
          PAPERCLIP_HERMES_CONFIG_YAML: [
            "model: gpt-5.3-codex",
            "terminal:",
            "  cwd: /tmp/host-cwd",
            "  timeout: 120",
            "",
          ].join("\n"),
        },
      },
      cwd,
      companyId: "company-1",
      managedHome: path.join(cwd, "company-hermes-home"),
      runtimeBundle: makeBundle(),
      authToken: null,
    });

    const env = nextConfig.env as Record<string, string | undefined>;
    expect(env.PAPERCLIP_HERMES_AUTH_JSON).toBeUndefined();
    expect(env.PAPERCLIP_HERMES_ENV).toBeUndefined();
    expect(env.PAPERCLIP_HERMES_CONFIG_YAML).toBeUndefined();
    expect(env.PAPERCLIP_HERMES_SHARED_HOME_SOURCE).toBeUndefined();
    expect(nextConfig.provider).toBe("openai-codex");
    expect(nextConfig.model).toBe("gpt-5.3-codex");

    const hermesHome = String(env.HERMES_HOME);
    const copiedAuth = await fs.readFile(path.join(hermesHome, "auth.json"), "utf8");
    const copiedEnv = await fs.readFile(path.join(hermesHome, ".env"), "utf8");
    const copiedConfig = await fs.readFile(path.join(hermesHome, "config.yaml"), "utf8");

    expect(copiedAuth).toContain("openai-codex");
    expect(copiedAuth.endsWith("\n")).toBe(true);
    expect(copiedEnv).toContain("OPENAI_API_KEY=inline-key");
    expect(copiedEnv).not.toContain("TERMINAL_CWD=/tmp/host-cwd");
    expect(copiedConfig).toContain("terminal:");
    expect(copiedConfig).toContain("timeout: 120");
    expect(copiedConfig).not.toContain("cwd: /tmp/host-cwd");
  });

  it("imports an existing Hermes home into managed runtime files without leaving import hints in env", async () => {
    const cwd = await makeTempDir();
    const importHome = await makeTempDir();
    await fs.writeFile(
      path.join(importHome, "auth.json"),
      JSON.stringify({ active_provider: "openai-codex", providers: { "openai-codex": { tokens: { access_token: "secret" } } } }) + "\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(importHome, ".env"),
      ["OPENROUTER_API_KEY=imported-secret", "TERMINAL_CWD=/tmp/host-only", ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(importHome, "config.yaml"),
      [
        "model:",
        "  provider: openai-codex",
        "  default: gpt-5.4",
        "terminal:",
        "  backend: local",
        "  cwd: /tmp/host-only",
        "mcp_servers:",
        "  github:",
        "    command: npx",
        "platform_toolsets:",
        "  cli:",
        "    - hermes-cli",
        "toolsets:",
        "  - hermes-cli",
        "",
      ].join("\n"),
      "utf8",
    );

    const nextConfig = await prepareHermesAdapterConfigForExecution({
      config: {
        env: {
          PAPERCLIP_HERMES_IMPORT_HOME: importHome,
        },
      },
      cwd,
      companyId: "company-1",
      managedHome: path.join(cwd, "company-hermes-home"),
      runtimeBundle: makeBundle(),
      authToken: null,
    });

    const env = nextConfig.env as Record<string, string | undefined>;
    expect(env.PAPERCLIP_HERMES_IMPORT_HOME).toBeUndefined();
    expect(env.PAPERCLIP_HERMES_SHARED_HOME_SOURCE).toBeUndefined();
    expect(env.PAPERCLIP_HERMES_BOOTSTRAP_SUMMARY_JSON).toBeTruthy();

    const summary = JSON.parse(String(env.PAPERCLIP_HERMES_BOOTSTRAP_SUMMARY_JSON)) as {
      activeProvider: string | null;
      configuredProvider: string | null;
      defaultModel: string | null;
      mcpServerNames: string[];
      enabledPlatforms: string[];
      secretEnvKeys: string[];
    };
    expect(summary.activeProvider).toBe("openai-codex");
    expect(summary.configuredProvider).toBe("openai-codex");
    expect(summary.defaultModel).toBe("gpt-5.4");
    expect(summary.mcpServerNames).toEqual(["github"]);
    expect(summary.enabledPlatforms).toEqual(["cli"]);
    expect(summary.secretEnvKeys).toEqual(["OPENROUTER_API_KEY", "TERMINAL_CWD"]);

    const hermesHome = String(env.HERMES_HOME);
    const copiedAuth = await fs.readFile(path.join(hermesHome, "auth.json"), "utf8");
    const copiedEnv = await fs.readFile(path.join(hermesHome, ".env"), "utf8");
    const copiedConfig = await fs.readFile(path.join(hermesHome, "config.yaml"), "utf8");
    expect(copiedAuth).toContain("openai-codex");
    expect(copiedEnv).toContain("OPENROUTER_API_KEY=imported-secret");
    expect(copiedEnv).not.toContain("TERMINAL_CWD=/tmp/host-only");
    expect(copiedConfig).toContain("provider: openai-codex");
    expect(copiedConfig).not.toContain("cwd: /tmp/host-only");
    expect(nextConfig.provider).toBe("openai-codex");
    expect(nextConfig.model).toBe("gpt-5.4");
  });

  it("prepends the runtime note to an existing custom prompt template without overwriting explicit credentials", async () => {
    const cwd = await makeTempDir();
    const sharedSource = await makeTempDir();
    await fs.writeFile(
      path.join(sharedSource, "auth.json"),
      JSON.stringify({ active_provider: "openai-codex" }) + "\n",
      "utf8",
    );
    const nextConfig = await prepareHermesAdapterConfigForExecution({
      config: {
        promptTemplate: "Custom instructions for {{agentName}}",
        env: {
          PAPERCLIP_API_KEY: "preset-key",
          PAPERCLIP_HERMES_SHARED_HOME_SOURCE: sharedSource,
        },
        model: "gpt-5.2-codex",
        provider: "openai-codex",
      },
      cwd,
      companyId: "company-1",
      managedHome: path.join(cwd, "company-hermes-home"),
      runtimeBundle: makeBundle(),
      authToken: "jwt-token-456",
    });

    const env = nextConfig.env as Record<string, string>;
    expect(env.PAPERCLIP_API_KEY).toBe("preset-key");
    expect(env.PAPERCLIP_API_HELPER_PATH).toContain(path.join(".paperclip", "runtime", "paperclip-api"));
    const helper = await fs.readFile(env.PAPERCLIP_API_HELPER_PATH, "utf8");
    expect(helper).toContain("urllib.request");
    expect(String(nextConfig.promptTemplate)).toContain("Paperclip runtime note:");
    expect(String(nextConfig.promptTemplate)).toContain("Custom instructions for {{agentName}}");
    expect(nextConfig.provider).toBe("openai-codex");
    expect(nextConfig.model).toBe("gpt-5.2-codex");
  });

  it("embeds issue-backed task workflow details into the prompt template for custom prompts", async () => {
    const cwd = await makeTempDir();
    const sharedSource = await makeTempDir();
    await fs.writeFile(
      path.join(sharedSource, "auth.json"),
      JSON.stringify({ active_provider: "openai-codex" }) + "\n",
      "utf8",
    );
    const nextConfig = await prepareHermesAdapterConfigForExecution({
      config: {
        promptTemplate: "Custom instructions for {{agentName}}",
        env: {
          PAPERCLIP_HERMES_SHARED_HOME_SOURCE: sharedSource,
        },
      },
      cwd,
      companyId: "company-1",
      managedHome: path.join(cwd, "company-hermes-home"),
      runtimeBundle: makeBundle({
        issue: {
          id: "issue-99",
          identifier: "PAP-99",
          title: "Fix planner prompt contract",
          status: "in_progress",
          priority: "high",
        },
        memory: {
          snippets: [
            {
              scope: "issue",
              source: "issue.description",
              sourceId: "issue-99",
              content: "Use the assigned issue workflow, not the generic todo wake.",
              freshness: "static",
              updatedAt: "2026-03-24T00:00:00.000Z",
              rank: 1,
            },
          ],
        },
      }),
      authToken: "jwt-token-789",
    });

    const promptTemplate = String(nextConfig.promptTemplate);
    expect(promptTemplate).toContain("## Assigned Task");
    expect(promptTemplate).toContain("Issue ID: {{taskId}}");
    expect(promptTemplate).toContain("Title: {{taskTitle}}");
    expect(promptTemplate).toContain("{{taskBody}}");
    expect(promptTemplate).toContain("patch /api/issues/{{taskId}} --json '{\"status\":\"done\"}'");
    expect(promptTemplate).toContain("{{#noTask}}");
    expect(promptTemplate).toContain("Check your assigned todo issues");
  });
});

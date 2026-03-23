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
    const nextConfig = await prepareHermesAdapterConfigForExecution({
      config: {
        model: "anthropic/claude-sonnet-4",
        env: { PAPERCLIP_HERMES_SHARED_HOME_SOURCE: sharedSource },
      },
      cwd,
      agentHome: path.join(cwd, "agent-home"),
      runtimeBundle: makeBundle(),
      authToken: "jwt-token-123",
    });

    const env = nextConfig.env as Record<string, string>;
    expect(env.PAPERCLIP_API_KEY).toBe("jwt-token-123");
    expect(env.PAPERCLIP_RUNTIME_ROOT).toContain(path.join(".paperclip", "runtime"));
    expect(env.PAPERCLIP_RUNTIME_BUNDLE_PATH).toContain(path.join(".paperclip", "runtime", "bundle.json"));
    expect(env.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH).toContain(path.join(".paperclip", "runtime", "instructions.md"));
    expect(env.PAPERCLIP_ISSUE_ID).toBe("issue-1");
    expect(env.PAPERCLIP_PROJECT_ID).toBe("project-1");
    expect(env.PAPERCLIP_SHARED_CONTEXT_PATH).toContain(path.join(".paperclip", "context", "shared-context.json"));
    expect(env.PAPERCLIP_SHARED_CONTEXT_JSON).toContain("\"issueId\":\"issue-1\"");
    expect(env.HERMES_HOME).toContain(path.join("agent-home"));

    const bundleJson = await fs.readFile(env.PAPERCLIP_RUNTIME_BUNDLE_PATH, "utf8");
    expect(bundleJson).toContain('"runtime": "hermes"');

    const instructions = await fs.readFile(env.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH, "utf8");
    expect(instructions).toContain("Paperclip hermes runtime projection");

    const sharedContext = JSON.parse(await fs.readFile(env.PAPERCLIP_SHARED_CONTEXT_PATH, "utf8")) as {
      companyId: string;
      issueId: string | null;
      memory: RuntimeBundle["memory"];
    };
    expect(sharedContext.companyId).toBe("company-1");
    expect(sharedContext.issueId).toBe("issue-1");
    expect(sharedContext.memory.snippets).toHaveLength(1);

    const copiedAuth = await fs.readFile(path.join(env.HERMES_HOME, "auth.json"), "utf8");

    expect(copiedAuth).toContain("openai-codex");

    expect(String(nextConfig.promptTemplate)).toContain("Paperclip runtime note:");
    expect(String(nextConfig.promptTemplate)).toContain("shared context packet");
    expect(String(nextConfig.promptTemplate)).toContain("Authorization: Bearer $PAPER...Y");
    expect(nextConfig.provider).toBe("openai-codex");
    expect(nextConfig.model).toBe("gpt-5.3-codex");
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
      agentHome: path.join(cwd, "agent-home"),
      runtimeBundle: makeBundle(),
      authToken: "jwt-token-456",
    });

    const env = nextConfig.env as Record<string, string>;
    expect(env.PAPERCLIP_API_KEY).toBe("preset-key");
    expect(String(nextConfig.promptTemplate)).toContain("Paperclip runtime note:");
    expect(String(nextConfig.promptTemplate)).toContain("Custom instructions for {{agentName}}");
    expect(nextConfig.provider).toBe("openai-codex");
    expect(nextConfig.model).toBe("gpt-5.2-codex");
  });
});

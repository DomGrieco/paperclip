import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "@paperclipai/adapter-cursor-local/server";

async function writeFakeCursorCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const bundlePath = process.env.PAPERCLIP_RUNTIME_BUNDLE_PATH || null;
const runtimeRoot = process.env.PAPERCLIP_RUNTIME_ROOT || null;
const instructionsPath = process.env.PAPERCLIP_RUNTIME_INSTRUCTIONS_PATH || null;
const payload = {
  argv: process.argv.slice(2),
  prompt: fs.readFileSync(0, "utf8"),
  runtimeRoot,
  bundlePath,
  instructionsPath,
  instructionsMarkdown: instructionsPath ? fs.readFileSync(instructionsPath, "utf8") : null,
  bundleJson: bundlePath ? JSON.parse(fs.readFileSync(bundlePath, "utf8")) : null,
  verificationJson: runtimeRoot ? JSON.parse(fs.readFileSync(require("node:path").join(runtimeRoot, "verification.json"), "utf8")) : null,
  paperclipEnvKeys: Object.keys(process.env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort(),
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "cursor-session-1",
  model: "auto",
}));
console.log(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "output_text", text: "hello" }] },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  session_id: "cursor-session-1",
  result: "ok",
}));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

type CapturePayload = {
  argv: string[];
  prompt: string;
  runtimeRoot: string | null;
  bundlePath: string | null;
  instructionsPath: string | null;
  instructionsMarkdown: string | null;
  bundleJson: Record<string, unknown> | null;
  verificationJson: Record<string, unknown> | null;
  paperclipEnvKeys: string[];
};

describe("cursor execute", () => {
  it("injects paperclip env vars and prompt note by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-cursor-execute-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "agent");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCursorCommand(commandPath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    let invocationPrompt = "";
    try {
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Cursor Coder",
          adapterType: "cursor",
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
          model: "auto",
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {
          paperclipRuntimeBundle: {
            runtime: "cursor",
            company: { id: "company-1" },
            agent: { id: "agent-1", name: "Cursor Coder", adapterType: "cursor" },
            project: null,
            issue: { id: "issue-1", identifier: "TST-2", title: "Cursor runtime materialization", status: "in_progress", priority: "high" },
            run: { id: "run-1", runType: "worker", rootRunId: "run-0", parentRunId: "run-0", graphDepth: 1, repairAttempt: 0, verificationVerdict: null },
            policy: { tddMode: "required", evidencePolicy: "code_ci_evaluator_summary_artifacts", evidencePolicySource: "issue_override", maxRepairAttempts: 5, requiresHumanArtifacts: true },
            runner: { target: "cloud_sandbox", provider: "cloud_sandbox", workspaceStrategyType: null, executionMode: null, browserCapable: true, sandboxed: true, isolationBoundary: "cloud_sandbox" },
            verification: { required: true, requiresEvaluatorSummary: true, requiresArtifacts: true, latestVerificationRunId: null, reviewReadyAt: null, runner: { target: "cloud_sandbox", provider: "cloud_sandbox", workspaceStrategyType: null, executionMode: null, browserCapable: true, sandboxed: true, isolationBoundary: "cloud_sandbox" } },
            memory: { snippets: [{ scope: "issue", source: "issue.description", content: "Cursor should see runtime files." }] },
            projection: { runtime: "cursor", contextKey: "paperclipRuntimeBundle", envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON", materializationRoot: ".paperclip/runtime" },
          },
          paperclipRuntimeProjection: { runtime: "cursor", contextKey: "paperclipRuntimeBundle", envVar: "PAPERCLIP_RUNTIME_BUNDLE_JSON", materializationRoot: ".paperclip/runtime" },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          invocationPrompt = meta.prompt ?? "";
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.argv).not.toContain("Follow the paperclip heartbeat.");
      expect(capture.argv).not.toContain("--mode");
      expect(capture.argv).not.toContain("ask");
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
      expect(capture.instructionsMarkdown).toContain("# Paperclip cursor runtime projection");
      expect(capture.instructionsMarkdown).toContain("Cursor runtime materialization");
      expect(capture.bundleJson?.runtime).toBe("cursor");
      expect(capture.verificationJson?.requiresArtifacts).toBe(true);
      expect(capture.prompt).toContain("Paperclip runtime note:");
      expect(capture.prompt).toContain("PAPERCLIP_API_KEY");
      expect(invocationPrompt).toContain("Paperclip runtime note:");
      expect(invocationPrompt).toContain("PAPERCLIP_API_URL");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("passes --mode when explicitly configured", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-cursor-execute-mode-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "agent");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCursorCommand(commandPath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const result = await execute({
        runId: "run-2",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Cursor Coder",
          adapterType: "cursor",
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
          model: "auto",
          mode: "ask",
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
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
      expect(capture.argv).toContain("--mode");
      expect(capture.argv).toContain("ask");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

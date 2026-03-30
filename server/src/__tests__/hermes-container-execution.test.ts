import { describe, expect, it } from "vitest";
import type { AdapterExecutionContext } from "../adapters/types.js";
import { buildPrompt, resolveContainerHermesCommand } from "../services/hermes-container-execution.js";

function buildContext(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Hermes CEO",
      adapterType: "hermes_local",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config: {},
    context: {},
    authToken: null,
    onLog: async () => undefined,
    ...overrides,
  };
}

describe("resolveContainerHermesCommand", () => {
  it("prefers the launch-plan container command over the host execution config command", () => {
    const command = resolveContainerHermesCommand(
      buildContext({
        context: {
          paperclipHermesContainerPlan: {
            command: ["/paperclip/runtime/hermes-managed/venv/bin/hermes"],
          },
        },
      }),
      {
        hermesCommand: "/Users/eru/.paperclip/runtime-cache/hermes/channels/stable/installs/current/venv/bin/hermes",
      },
    );

    expect(command).toBe("/paperclip/runtime/hermes-managed/venv/bin/hermes");
  });

  it("falls back to the configured command when no launch plan is present", () => {
    const command = resolveContainerHermesCommand(buildContext(), {
      hermesCommand: "/tmp/custom-hermes",
    });

    expect(command).toBe("/tmp/custom-hermes");
  });
});

describe("buildPrompt", () => {
  it("uses issue details from the runtime bundle when explicit task config is missing", () => {
    const prompt = buildPrompt(
      buildContext({
        context: {
          paperclipRuntimeBundle: {
            issue: {
              id: "issue-99",
              title: "Fix planner prompt contract",
            },
            project: {
              name: "Paperclip",
            },
            memory: {
              snippets: [
                {
                  source: "issue.description",
                  content: "Use the assigned issue workflow, not the generic todo wake.",
                },
              ],
            },
          },
        },
      }),
      {},
    );

    expect(prompt).toContain("## Assigned Task");
    expect(prompt).toContain("Issue ID: issue-99");
    expect(prompt).toContain("Title: Fix planner prompt contract");
    expect(prompt).toContain("Use the assigned issue workflow, not the generic todo wake.");
    expect(prompt).not.toContain("## Heartbeat Wake — Check for Work");
  });

  it("falls back to the no-task workflow when neither config nor runtime bundle provides an issue", () => {
    const prompt = buildPrompt(buildContext(), {});

    expect(prompt).toContain("## Heartbeat Wake — Check for Work");
    expect(prompt).toContain("Check your assigned todo issues");
    expect(prompt).not.toContain("## Assigned Task");
  });

  it("keeps the Paperclip API base at the server root and warns against overriding helper env", () => {
    const prompt = buildPrompt(buildContext(), { paperclipApiUrl: "http://paperclip-server-dev:3100" });

    expect(prompt).toContain("API Base: http://paperclip-server-dev:3100");
    expect(prompt).not.toContain("API Base: http://paperclip-server-dev:3100/api");
    expect(prompt).toContain("Do not re-export or rewrite `PAPERCLIP_API_URL`");
    expect(prompt).toContain("Do not pivot into host/IP probing, ad-hoc Python HTTP scripts");
    expect(prompt).toContain("/api/agents/{agentId}/wakeup");
    expect(prompt).toContain("Do not expand that initial read into `policy.json`, `runner.json`, `verification.json`");
    expect(prompt).toContain("top-level `/api/runs`, bare `/api`, and other broad discovery endpoints as forbidden");
  });

  it("appends a governed api contract for validation-shaped issue runs", () => {
    const prompt = buildPrompt(
      buildContext({
        context: {
          paperclipRuntimeBundle: {
            issue: {
              id: "issue-99",
              title: "Validate the planner path",
            },
            memory: {
              snippets: [
                {
                  source: "issue.description",
                  content:
                    "Acceptance criteria: do not call /api/agents/{agentId}/wakeup, do not call top-level /api/runs, keep API reads narrow, and leave pass/fail evidence.",
                },
              ],
            },
          },
        },
      }),
      {},
    );

    expect(prompt).toContain("## Governed API contract");
    expect(prompt).toContain("mode=issue_validation_narrow");
    expect(prompt).toContain("GET /api/issues/issue-99 (max 2)");
    expect(prompt).toContain("POST /api/issues/issue-99/comments (max 1)");
    expect(prompt).toContain("PATCH /api/issues/issue-99 (max 1)");
  });
});

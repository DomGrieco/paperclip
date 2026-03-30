import { describe, expect, it } from "vitest";
import type { AdapterExecutionContext } from "../adapters/types.js";
import { buildPrompt, parseHermesOutput, resolveContainerHermesCommand } from "../services/hermes-container-execution.js";

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

  it("adds a planner orchestration contract for planner-root runs", () => {
    const prompt = buildPrompt(
      buildContext({
        context: {
          paperclipRuntimeBundle: {
            issue: {
              id: "issue-42",
              title: "Planner-grade orchestration validation",
            },
            run: {
              id: "run-1",
              runType: "planner",
              rootRunId: "run-1",
              parentRunId: null,
            },
            swarm: {
              plan: null,
              currentSubtask: null,
            },
            memory: {
              snippets: [
                {
                  source: "issue.description",
                  content: "Delegate at least two concrete child workstreams when appropriate.",
                },
              ],
            },
          },
        },
      }),
      {},
    );

    expect(prompt).toContain("## Planner orchestration contract");
    expect(prompt).toContain("PAPERCLIP_RESULT_JSON_START");
    expect(prompt).toContain("Paperclip materializes child runs from structured planner output");
    expect(prompt).toContain("POST /api/issues/{issueId}/runs");
    expect(prompt).toContain("Allowed subtask kinds are exactly");
    expect(prompt).toContain("`verification` for QA/browser-visible validation work");
    expect(prompt).toContain("Allowed artifact kinds are exactly");
    expect(prompt).toContain("`read_only` or `advisory`");
  });

  it("adds a worker completion contract for swarm worker runs with a current subtask", () => {
    const prompt = buildPrompt(
      buildContext({
        context: {
          paperclipRuntimeBundle: {
            issue: {
              id: "issue-77",
              title: "Worker evidence validation",
            },
            run: {
              id: "run-worker-1",
              runType: "worker",
              rootRunId: "run-planner-1",
              parentRunId: "run-planner-1",
            },
            swarm: {
              plan: null,
              currentSubtask: {
                id: "subtask-verify",
                kind: "verification",
                title: "Verify overlap",
                goal: "Produce overlap proof and evidence.",
                taskKey: "verify-overlap",
                expectedArtifacts: [
                  { kind: "test_result", required: true },
                  { kind: "comment", required: true },
                ],
                acceptanceChecks: ["Evidence cites run ids"],
                recommendedModelTier: "balanced",
              },
            },
          },
        },
      }),
      {},
    );

    expect(prompt).toContain("## Worker completion contract");
    expect(prompt).toContain("swarm worker for subtask `verify-overlap`");
    expect(prompt).toContain("Required expected artifacts for this subtask: [{\"kind\":\"test_result\",\"required\":true},{\"kind\":\"comment\",\"required\":true}]");
    expect(prompt).toContain("Acceptance checks for this subtask: [\"Evidence cites run ids\"]");
    expect(prompt).toContain("\"childOutput\"");
    expect(prompt).toContain("artifactClaims");
    expect(prompt).toContain("Allowed child output status values are exactly `completed` or `blocked`");
    expect(prompt).toContain("Allowed artifact kinds are exactly: `summary`, `patch`, `test_result`, `comment`, `document`");
  });
});

describe("parseHermesOutput", () => {
  it("extracts structured Paperclip result JSON blocks from the Hermes response", () => {
    const parsed = parseHermesOutput(
      [
        "Planner summary for board review.",
        "PAPERCLIP_RESULT_JSON_START",
        JSON.stringify({
          swarmPlan: {
            version: "v1",
            rationale: "Split implementation and verification.",
            subtasks: [
              {
                id: "worker-1",
                kind: "implementation",
                title: "Implement change",
                goal: "Land the patch.",
                acceptanceChecks: ["Patch exists"],
                expectedArtifacts: [{ kind: "patch", required: true }],
                recommendedModelTier: "balanced",
                budgetCents: 25,
                maxRuntimeSec: 900,
              },
            ],
          },
        }),
        "PAPERCLIP_RESULT_JSON_END",
        "session_id: sess-123",
      ].join("\n"),
      "",
    );

    expect(parsed.response).toBe("Planner summary for board review.");
    expect(parsed.sessionId).toBe("sess-123");
    expect(parsed.resultJson).toEqual(
      expect.objectContaining({
        swarmPlan: expect.objectContaining({
          version: "v1",
          subtasks: [expect.objectContaining({ id: "worker-1" })],
        }),
      }),
    );
  });
});

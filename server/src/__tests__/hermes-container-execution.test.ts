import { describe, expect, it } from "vitest";
import type { AdapterExecutionContext } from "../adapters/types.js";
import { buildPrompt } from "../services/hermes-container-execution.js";

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
  });
});

import { describe, expect, it, vi } from "vitest";
import { sharedContextService } from "../services/shared-context-publications.ts";

function createRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date("2026-03-24T00:00:00.000Z");
  return {
    id: "shared-1",
    companyId: "company-1",
    projectId: "project-1",
    issueId: null,
    sourceAgentId: "agent-1",
    createdByRunId: "run-1",
    title: "Shared note",
    summary: "Summary",
    body: "Details",
    tags: ["runtime"],
    visibility: "project",
    audienceAgentIds: [],
    status: "published",
    freshness: "recent",
    freshnessAt: now,
    confidence: 90,
    rank: 5,
    provenance: { source: "worker" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockDb(row: Record<string, unknown>) {
  const returning = vi.fn(async () => [row]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return { db: { insert } as any, insert, values, returning };
}

describe("sharedContextService.create", () => {
  it("downgrades agent company-wide publications to proposed governance state", async () => {
    const row = createRow({ visibility: "company", status: "proposed", projectId: null });
    const { db, values } = createMockDb(row);
    const svc = sharedContextService(db);

    const result = await svc.create(
      "company-1",
      {
        title: "Company-wide convention",
        body: "Needs review before becoming company-wide guidance.",
        visibility: "company",
      },
      { type: "agent", agentId: "agent-1", runId: "run-1" },
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        sourceAgentId: "agent-1",
        createdByRunId: "run-1",
        visibility: "company",
        status: "proposed",
      }),
    );
    expect(result.status).toBe("proposed");
  });

  it("lets agent issue-scoped publications flow straight into published state", async () => {
    const row = createRow({ visibility: "issue", status: "published", issueId: "issue-1" });
    const { db, values } = createMockDb(row);
    const svc = sharedContextService(db);

    const result = await svc.create(
      "company-1",
      {
        projectId: "project-1",
        issueId: "issue-1",
        title: "Issue finding",
        body: "This is immediately relevant to the current issue.",
        visibility: "issue",
      },
      { type: "agent", agentId: "agent-1", runId: "run-1" },
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: "issue",
        status: "published",
        issueId: "issue-1",
      }),
    );
    expect(result.status).toBe("published");
  });
});

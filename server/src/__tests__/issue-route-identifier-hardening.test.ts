import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({ canUser: vi.fn(), hasPermission: vi.fn() }),
  agentService: () => ({ getById: vi.fn() }),
  executionWorkspaceService: () => ({ getById: vi.fn() }),
  goalService: () => ({ getById: vi.fn(), getDefaultCompanyGoal: vi.fn() }),
  heartbeatService: () => ({ getRun: vi.fn() }),
  issueApprovalService: () => ({ listForIssue: vi.fn() }),
  issueRunGraphService: () => ({ getIssueSummary: vi.fn() }),
  issueService: () => mockIssueService,
  documentService: () => ({ getIssueDocumentPayload: vi.fn() }),
  logActivity: vi.fn(),
  projectService: () => ({ getById: vi.fn(), listByIds: vi.fn() }),
  workProductService: () => ({ listForIssue: vi.fn() }),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue route identifier hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    mockIssueService.getById.mockResolvedValue(null);
  });

  it("returns 404 instead of 500 for numeric issue ids on orchestration endpoints", async () => {
    const res = await request(createApp()).get("/api/issues/1/run-graph");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Issue not found" });
    expect(mockIssueService.getByIdentifier).not.toHaveBeenCalled();
    expect(mockIssueService.getById).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000000");
  });

  it("still resolves canonical issue identifiers before loading the issue", async () => {
    mockIssueService.getByIdentifier.mockResolvedValue({ id: "issue-uuid-1", companyId: "company-1" });
    mockIssueService.getById.mockResolvedValue(null);

    const res = await request(createApp()).get("/api/issues/PAP-12/run-graph");

    expect(res.status).toBe(404);
    expect(mockIssueService.getByIdentifier).toHaveBeenCalledWith("PAP-12");
    expect(mockIssueService.getById).toHaveBeenCalledWith("issue-uuid-1");
  });
});

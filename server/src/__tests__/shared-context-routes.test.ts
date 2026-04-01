import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { sharedContextRoutes } from "../routes/shared-context.js";

const mockSharedContextService = vi.hoisted(() => ({
  listAuthorized: vi.fn(),
  create: vi.fn(),
  updateStatus: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  sharedContextService: () => mockSharedContextService,
  logActivity: mockLogActivity,
}));

type Actor = Record<string, unknown>;

function createApp(actor: Actor) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as any;
    next();
  });
  app.use("/api", sharedContextRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const boardActor = {
  type: "board",
  userId: "user-1",
  source: "session",
  isInstanceAdmin: false,
  companyIds: ["company-1"],
};

const agentActor = {
  type: "agent",
  agentId: "agent-9",
  companyId: "company-1",
  runId: "run-1",
  source: "api_key",
};

describe("shared context routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSharedContextService.listAuthorized.mockResolvedValue([]);
  });

  it("passes board actor visibility through the shared-context list route", async () => {
    mockSharedContextService.listAuthorized.mockResolvedValueOnce([
      { id: "published-1", title: "Published", status: "published" },
    ]);

    const res = await request(createApp(boardActor)).get(
      "/api/companies/company-1/shared-context?issueId=issue-1&status=published",
    );

    expect(res.status).toBe(200);
    expect(mockSharedContextService.listAuthorized).toHaveBeenCalledWith(
      "company-1",
      {
        projectId: undefined,
        issueId: "issue-1",
        sourceAgentId: undefined,
        status: "published",
        visibility: undefined,
      },
      { type: "board" },
    );
    expect(res.body).toEqual([
      expect.objectContaining({ id: "published-1", status: "published" }),
    ]);
  });

  it("passes agent identity through the shared-context list route", async () => {
    mockSharedContextService.listAuthorized.mockResolvedValueOnce([
      { id: "proposal-1", title: "Own draft", status: "proposed" },
    ]);

    const res = await request(createApp(agentActor)).get(
      "/api/companies/company-1/shared-context?issueId=issue-1",
    );

    expect(res.status).toBe(200);
    expect(mockSharedContextService.listAuthorized).toHaveBeenCalledWith(
      "company-1",
      {
        projectId: undefined,
        issueId: "issue-1",
        sourceAgentId: undefined,
        status: undefined,
        visibility: undefined,
      },
      { type: "agent", agentId: "agent-9" },
    );
    expect(res.body).toEqual([
      expect.objectContaining({ id: "proposal-1", status: "proposed" }),
    ]);
  });

  it("rejects reads outside the actor company scope", async () => {
    const res = await request(createApp(boardActor)).get("/api/companies/company-2/shared-context");

    expect(res.status).toBe(403);
    expect(mockSharedContextService.listAuthorized).not.toHaveBeenCalled();
  });
});

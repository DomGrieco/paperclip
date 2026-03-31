import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflict, notFound } from "../errors.js";
import { errorHandler } from "../middleware/index.js";
import { managedSkillRoutes } from "../routes/managed-skills.js";

const mockManagedSkillService = vi.hoisted(() => ({
  listManagedSkills: vi.fn(),
  createManagedSkill: vi.fn(),
  getManagedSkill: vi.fn(),
  updateManagedSkill: vi.fn(),
  archiveManagedSkill: vi.fn(),
  restoreManagedSkill: vi.fn(),
  listManagedSkillScopes: vi.fn(),
  replaceManagedSkillScopes: vi.fn(),
  previewEffectiveSkills: vi.fn(),
}));

vi.mock("../services/managed-skills.js", () => ({
  managedSkillService: () => mockManagedSkillService,
}));

type Actor = Record<string, unknown>;

function createApp(actor: Actor) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as any;
    next();
  });
  app.use("/api", managedSkillRoutes({} as any));
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

describe("managed skill routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists managed skills for an authorized board user", async () => {
    mockManagedSkillService.listManagedSkills.mockResolvedValueOnce([
      {
        id: "skill-1",
        companyId: "company-1",
        name: "Skill One",
        slug: "skill-one",
        description: "First skill",
        bodyMarkdown: "# Skill One",
        status: "active",
        createdAt: new Date("2026-03-31T00:00:00.000Z"),
        updatedAt: new Date("2026-03-31T00:00:00.000Z"),
      },
    ]);

    const res = await request(createApp(boardActor)).get("/api/companies/company-1/managed-skills");

    expect(res.status).toBe(200);
    expect(mockManagedSkillService.listManagedSkills).toHaveBeenCalledWith("company-1");
    expect(res.body).toEqual([
      expect.objectContaining({
        id: "skill-1",
        slug: "skill-one",
        status: "active",
      }),
    ]);
  });

  it("creates a managed skill and returns 201", async () => {
    mockManagedSkillService.createManagedSkill.mockResolvedValueOnce({
      id: "skill-2",
      companyId: "company-1",
      name: "Skill Two",
      slug: "skill-two",
      description: null,
      bodyMarkdown: "# Skill Two",
      status: "active",
      createdAt: new Date("2026-03-31T00:00:00.000Z"),
      updatedAt: new Date("2026-03-31T00:00:00.000Z"),
    });

    const payload = {
      name: "Skill Two",
      slug: "skill-two",
      description: null,
      bodyMarkdown: "# Skill Two",
      status: "active",
    };

    const res = await request(createApp(boardActor))
      .post("/api/companies/company-1/managed-skills")
      .send(payload);

    expect(res.status).toBe(201);
    expect(mockManagedSkillService.createManagedSkill).toHaveBeenCalledWith("company-1", payload);
    expect(res.body).toEqual(expect.objectContaining({ id: "skill-2", slug: "skill-two" }));
  });

  it("allows duplicate slugs so scoped overrides can coexist", async () => {
    mockManagedSkillService.createManagedSkill.mockResolvedValueOnce({
      id: "skill-3",
      companyId: "company-1",
      name: "Skill Two Project Override",
      slug: "skill-two",
      description: "Project-specific override",
      bodyMarkdown: "# Project",
      status: "active",
      createdAt: new Date("2026-03-31T00:01:00.000Z"),
      updatedAt: new Date("2026-03-31T00:01:00.000Z"),
    });

    const payload = {
      name: "Skill Two Project Override",
      slug: "skill-two",
      description: "Project-specific override",
      bodyMarkdown: "# Project",
      status: "active",
    };

    const res = await request(createApp(boardActor))
      .post("/api/companies/company-1/managed-skills")
      .send(payload);

    expect(res.status).toBe(201);
    expect(mockManagedSkillService.createManagedSkill).toHaveBeenCalledWith("company-1", payload);
    expect(res.body).toEqual(expect.objectContaining({ id: "skill-3", slug: "skill-two" }));
  });

  it("returns 400 for invalid create payloads", async () => {
    const res = await request(createApp(boardActor))
      .post("/api/companies/company-1/managed-skills")
      .send({ name: "", bodyMarkdown: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockManagedSkillService.createManagedSkill).not.toHaveBeenCalled();
  });

  it("returns a managed skill by id", async () => {
    mockManagedSkillService.getManagedSkill.mockResolvedValueOnce({
      id: "skill-1",
      companyId: "company-1",
      name: "Skill One",
      slug: "skill-one",
      description: "First skill",
      bodyMarkdown: "# Skill One",
      status: "active",
      createdAt: new Date("2026-03-31T00:00:00.000Z"),
      updatedAt: new Date("2026-03-31T00:00:00.000Z"),
    });

    const res = await request(createApp(boardActor)).get("/api/companies/company-1/managed-skills/skill-1");

    expect(res.status).toBe(200);
    expect(mockManagedSkillService.getManagedSkill).toHaveBeenCalledWith("company-1", "skill-1");
    expect(res.body).toEqual(expect.objectContaining({ id: "skill-1", slug: "skill-one" }));
  });

  it("patches a managed skill", async () => {
    mockManagedSkillService.updateManagedSkill.mockResolvedValueOnce({
      id: "skill-1",
      companyId: "company-1",
      name: "Skill One Updated",
      slug: "skill-one",
      description: "Updated",
      bodyMarkdown: "# Updated",
      status: "active",
      createdAt: new Date("2026-03-31T00:00:00.000Z"),
      updatedAt: new Date("2026-03-31T00:05:00.000Z"),
    });

    const payload = { description: "Updated", bodyMarkdown: "# Updated" };
    const res = await request(createApp(boardActor))
      .patch("/api/companies/company-1/managed-skills/skill-1")
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockManagedSkillService.updateManagedSkill).toHaveBeenCalledWith("company-1", "skill-1", payload);
    expect(res.body).toEqual(expect.objectContaining({ description: "Updated" }));
  });

  it("returns 400 when patch payload is empty", async () => {
    const res = await request(createApp(boardActor))
      .patch("/api/companies/company-1/managed-skills/skill-1")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockManagedSkillService.updateManagedSkill).not.toHaveBeenCalled();
  });

  it("archives a managed skill", async () => {
    mockManagedSkillService.archiveManagedSkill.mockResolvedValueOnce({
      id: "skill-1",
      companyId: "company-1",
      name: "Skill One",
      slug: "skill-one",
      description: "Archived",
      bodyMarkdown: "# Skill One",
      status: "archived",
      createdAt: new Date("2026-03-31T00:00:00.000Z"),
      updatedAt: new Date("2026-03-31T00:05:00.000Z"),
    });

    const res = await request(createApp(boardActor)).post("/api/companies/company-1/managed-skills/skill-1/archive");

    expect(res.status).toBe(200);
    expect(mockManagedSkillService.archiveManagedSkill).toHaveBeenCalledWith("company-1", "skill-1");
    expect(res.body).toEqual(expect.objectContaining({ status: "archived" }));
  });

  it("restores a managed skill", async () => {
    mockManagedSkillService.restoreManagedSkill.mockResolvedValueOnce({
      id: "skill-1",
      companyId: "company-1",
      name: "Skill One",
      slug: "skill-one",
      description: "Restored",
      bodyMarkdown: "# Skill One",
      status: "active",
      createdAt: new Date("2026-03-31T00:00:00.000Z"),
      updatedAt: new Date("2026-03-31T00:06:00.000Z"),
    });

    const res = await request(createApp(boardActor)).post("/api/companies/company-1/managed-skills/skill-1/restore");

    expect(res.status).toBe(200);
    expect(mockManagedSkillService.restoreManagedSkill).toHaveBeenCalledWith("company-1", "skill-1");
    expect(res.body).toEqual(expect.objectContaining({ status: "active" }));
  });

  it("lists managed skill scopes", async () => {
    mockManagedSkillService.listManagedSkillScopes.mockResolvedValueOnce([
      {
        id: "scope-1",
        skillId: "skill-1",
        companyId: "company-1",
        scopeType: "company",
        scopeId: "company-1",
        projectId: null,
        agentId: null,
        enabled: true,
        createdAt: new Date("2026-03-31T00:00:00.000Z"),
        updatedAt: new Date("2026-03-31T00:00:00.000Z"),
      },
    ]);

    const res = await request(createApp(boardActor)).get("/api/companies/company-1/managed-skills/skill-1/scopes");

    expect(res.status).toBe(200);
    expect(mockManagedSkillService.listManagedSkillScopes).toHaveBeenCalledWith("company-1", "skill-1");
    expect(res.body).toEqual([
      expect.objectContaining({ id: "scope-1", scopeType: "company", scopeId: "company-1" }),
    ]);
  });

  it("replaces managed skill scopes", async () => {
    mockManagedSkillService.replaceManagedSkillScopes.mockResolvedValueOnce([
      {
        id: "scope-2",
        skillId: "skill-1",
        companyId: "company-1",
        scopeType: "project",
        scopeId: "11111111-1111-1111-1111-111111111111",
        projectId: "11111111-1111-1111-1111-111111111111",
        agentId: null,
        enabled: true,
        createdAt: new Date("2026-03-31T00:00:00.000Z"),
        updatedAt: new Date("2026-03-31T00:00:00.000Z"),
      },
    ]);

    const payload = {
      assignments: [
        {
          scopeType: "project",
          projectId: "11111111-1111-1111-1111-111111111111",
        },
      ],
    };

    const res = await request(createApp(boardActor))
      .put("/api/companies/company-1/managed-skills/skill-1/scopes")
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockManagedSkillService.replaceManagedSkillScopes).toHaveBeenCalledWith(
      "company-1",
      "skill-1",
      payload.assignments,
    );
    expect(res.body).toEqual([
      expect.objectContaining({ scopeType: "project", projectId: "11111111-1111-1111-1111-111111111111" }),
    ]);
  });

  it("returns the effective preview for board users", async () => {
    mockManagedSkillService.previewEffectiveSkills.mockResolvedValueOnce({
      companyId: "company-1",
      projectId: "11111111-1111-1111-1111-111111111111",
      agentId: "22222222-2222-2222-2222-222222222222",
      generatedAt: new Date("2026-03-31T00:00:00.000Z"),
      counts: {
        total: 1,
        builtin: 0,
        managed: 1,
      },
      entries: [
        {
          name: "skill-one",
          description: "Preview",
          bodyMarkdown: "# Preview",
          sourceType: "project",
          sourceLabel: "project",
          managedSkillId: "skill-1",
          scopeId: "11111111-1111-1111-1111-111111111111",
          managedSkillSlug: "skill-one",
          managedSkillUpdatedAt: new Date("2026-03-31T00:00:00.000Z"),
          resolutionRank: 3,
          candidates: [
            {
              sourceType: "project",
              sourceLabel: "project",
              managedSkillId: "skill-1",
              scopeId: "11111111-1111-1111-1111-111111111111",
              managedSkillSlug: "skill-one",
              managedSkillUpdatedAt: new Date("2026-03-31T00:00:00.000Z"),
              resolutionRank: 3,
            },
          ],
        },
      ],
    });

    const res = await request(createApp(boardActor)).get(
      "/api/companies/company-1/managed-skills/effective-preview?projectId=11111111-1111-1111-1111-111111111111&agentId=22222222-2222-2222-2222-222222222222",
    );

    expect(res.status).toBe(200);
    expect(mockManagedSkillService.previewEffectiveSkills).toHaveBeenCalledWith({
      companyId: "company-1",
      projectId: "11111111-1111-1111-1111-111111111111",
      agentId: "22222222-2222-2222-2222-222222222222",
      moduleDir: expect.any(String),
    });
    expect(res.body).toEqual({
      companyId: "company-1",
      projectId: "11111111-1111-1111-1111-111111111111",
      agentId: "22222222-2222-2222-2222-222222222222",
      generatedAt: "2026-03-31T00:00:00.000Z",
      counts: {
        total: 1,
        builtin: 0,
        managed: 1,
      },
      entries: [
        expect.objectContaining({
          name: "skill-one",
          sourceType: "project",
          resolutionRank: 3,
          candidates: [
            expect.objectContaining({
              sourceType: "project",
              managedSkillSlug: "skill-one",
            }),
          ],
        }),
      ],
    });
  });

  it("rejects unauthenticated callers", async () => {
    const res = await request(createApp({ type: "none" })).get(
      "/api/companies/company-1/managed-skills",
    );

    expect(res.status).toBe(401);
    expect(mockManagedSkillService.listManagedSkills).not.toHaveBeenCalled();
  });

  it("rejects agent callers even when they belong to the company", async () => {
    const res = await request(
      createApp({
        type: "agent",
        companyId: "company-1",
        agentId: "agent-1",
      }),
    ).get("/api/companies/company-1/managed-skills");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Board access required");
    expect(mockManagedSkillService.listManagedSkills).not.toHaveBeenCalled();
  });

  it("rejects non-board callers across managed-skill mutation and preview routes", async () => {
    const app = createApp({
      type: "agent",
      companyId: "company-1",
      agentId: "agent-1",
    });

    const createRes = await request(app).post("/api/companies/company-1/managed-skills").send({
      name: "Skill Two",
      slug: "skill-two",
      bodyMarkdown: "# Skill Two",
      status: "active",
    });
    const patchRes = await request(app)
      .patch("/api/companies/company-1/managed-skills/skill-1")
      .send({ description: "Updated" });
    const archiveRes = await request(app).post("/api/companies/company-1/managed-skills/skill-1/archive");
    const restoreRes = await request(app).post("/api/companies/company-1/managed-skills/skill-1/restore");
    const listScopesRes = await request(app).get("/api/companies/company-1/managed-skills/skill-1/scopes");
    const replaceScopesRes = await request(app)
      .put("/api/companies/company-1/managed-skills/skill-1/scopes")
      .send({ assignments: [{ scopeType: "company" }] });
    const previewRes = await request(app).get("/api/companies/company-1/managed-skills/effective-preview");

    expect(createRes.status).toBe(403);
    expect(createRes.body.error).toBe("Board access required");
    expect(patchRes.status).toBe(403);
    expect(patchRes.body.error).toBe("Board access required");
    expect(archiveRes.status).toBe(403);
    expect(archiveRes.body.error).toBe("Board access required");
    expect(restoreRes.status).toBe(403);
    expect(restoreRes.body.error).toBe("Board access required");
    expect(listScopesRes.status).toBe(403);
    expect(listScopesRes.body.error).toBe("Board access required");
    expect(replaceScopesRes.status).toBe(403);
    expect(replaceScopesRes.body.error).toBe("Board access required");
    expect(previewRes.status).toBe(403);
    expect(previewRes.body.error).toBe("Board access required");
    expect(mockManagedSkillService.createManagedSkill).not.toHaveBeenCalled();
    expect(mockManagedSkillService.updateManagedSkill).not.toHaveBeenCalled();
    expect(mockManagedSkillService.archiveManagedSkill).not.toHaveBeenCalled();
    expect(mockManagedSkillService.restoreManagedSkill).not.toHaveBeenCalled();
    expect(mockManagedSkillService.listManagedSkillScopes).not.toHaveBeenCalled();
    expect(mockManagedSkillService.replaceManagedSkillScopes).not.toHaveBeenCalled();
    expect(mockManagedSkillService.previewEffectiveSkills).not.toHaveBeenCalled();
  });

  it("rejects board users from other companies on managed-skill routes", async () => {
    const app = createApp({
      ...boardActor,
      companyIds: ["company-2"],
    });

    const responses = await Promise.all([
      request(app).get("/api/companies/company-1/managed-skills"),
      request(app).post("/api/companies/company-1/managed-skills/skill-1/archive"),
      request(app).get("/api/companies/company-1/managed-skills/effective-preview"),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("User does not have access to this company");
    }
    expect(mockManagedSkillService.listManagedSkills).not.toHaveBeenCalled();
    expect(mockManagedSkillService.archiveManagedSkill).not.toHaveBeenCalled();
    expect(mockManagedSkillService.previewEffectiveSkills).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid scope payloads", async () => {
    const res = await request(createApp(boardActor))
      .put("/api/companies/company-1/managed-skills/skill-1/scopes")
      .send({ assignments: [{ scopeType: "project" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockManagedSkillService.replaceManagedSkillScopes).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid effective-preview query params", async () => {
    const res = await request(createApp(boardActor)).get(
      "/api/companies/company-1/managed-skills/effective-preview?projectId=not-a-uuid",
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockManagedSkillService.previewEffectiveSkills).not.toHaveBeenCalled();
  });

  it("propagates service not-found errors with a stable payload", async () => {
    mockManagedSkillService.getManagedSkill.mockRejectedValueOnce(notFound("Managed skill not found"));

    const res = await request(createApp(boardActor)).get("/api/companies/company-1/managed-skills/missing-skill");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Managed skill not found" });
  });

  it("propagates service conflict errors with a stable payload", async () => {
    mockManagedSkillService.createManagedSkill.mockRejectedValueOnce(conflict("Managed skill slug already exists: skill-two"));

    const res = await request(createApp(boardActor))
      .post("/api/companies/company-1/managed-skills")
      .send({
        name: "Skill Two",
        slug: "skill-two",
        bodyMarkdown: "# Skill Two",
        status: "active",
      });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Managed skill slug already exists: skill-two" });
  });
});

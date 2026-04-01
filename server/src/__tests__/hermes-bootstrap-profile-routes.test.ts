import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { hermesBootstrapProfileRoutes } from "../routes/hermes-bootstrap-profiles.js";

const mockHermesBootstrapProfileService = vi.hoisted(() => ({
  getStoredProfile: vi.fn(),
  importFromHome: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  hermesBootstrapProfileService: () => mockHermesBootstrapProfileService,
  logActivity: mockLogActivity,
}));

function createApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", hermesBootstrapProfileRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("hermes bootstrap profile routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHermesBootstrapProfileService.getStoredProfile.mockResolvedValue({
      summary: {
        sourceHomePath: "/Users/eru/.hermes",
        hasAuthJson: true,
        hasEnvFile: true,
        hasConfigYaml: true,
        activeProvider: "openai-codex",
        authProviderIds: ["openai-codex"],
        configuredProvider: "openai-codex",
        defaultModel: "gpt-5.4",
        configuredBaseUrl: null,
        terminalBackend: "local",
        terminalCwd: "/Users/eru",
        mcpServerNames: ["github"],
        enabledPlatforms: ["cli"],
        enabledToolsets: ["web"],
        secretEnvKeys: ["OPENAI_API_KEY"],
      },
    });
    mockHermesBootstrapProfileService.importFromHome.mockResolvedValue({
      summary: {
        sourceHomePath: "/Users/eru/.hermes",
        hasAuthJson: true,
        hasEnvFile: true,
        hasConfigYaml: true,
        activeProvider: "openai-codex",
        authProviderIds: ["openai-codex"],
        configuredProvider: "openai-codex",
        defaultModel: "gpt-5.4",
        configuredBaseUrl: null,
        terminalBackend: "local",
        terminalCwd: "/Users/eru",
        mcpServerNames: ["github"],
        enabledPlatforms: ["cli"],
        enabledToolsets: ["web"],
        secretEnvKeys: ["OPENAI_API_KEY"],
      },
      payload: {
        authJson: "{}\n",
        envFile: "OPENAI_API_KEY=test\n",
        configYaml: "model: gpt-5.4\n",
      },
    });
  });

  it("returns the stored summary for authorized company readers", async () => {
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });

    const res = await request(app).get("/api/companies/company-1/hermes-bootstrap-profile");

    expect(res.status).toBe(200);
    expect(res.body.activeProvider).toBe("openai-codex");
    expect(mockHermesBootstrapProfileService.getStoredProfile).toHaveBeenCalledWith("company-1");
  });

  it("returns 404 when no stored profile exists", async () => {
    mockHermesBootstrapProfileService.getStoredProfile.mockResolvedValueOnce(null);
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });

    const res = await request(app).get("/api/companies/company-1/hermes-bootstrap-profile");

    expect(res.status).toBe(404);
  });

  it("imports and logs a Hermes bootstrap profile", async () => {
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/companies/company-1/hermes-bootstrap-profile/import")
      .send({ homePath: "/Users/eru/.hermes" });

    expect(res.status).toBe(201);
    expect(mockHermesBootstrapProfileService.importFromHome).toHaveBeenCalledWith(
      "company-1",
      { homePath: "/Users/eru/.hermes" },
      { userId: "user-1", agentId: null },
    );
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity.mock.calls[0]?.[1]?.action).toBe("company.hermes_bootstrap_profile_imported");
  });

  it("rejects callers without company access", async () => {
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-2"],
    });

    const res = await request(app)
      .post("/api/companies/company-1/hermes-bootstrap-profile/import")
      .send({ homePath: "/Users/eru/.hermes" });

    expect(res.status).toBe(403);
    expect(mockHermesBootstrapProfileService.importFromHome).not.toHaveBeenCalled();
  });
});

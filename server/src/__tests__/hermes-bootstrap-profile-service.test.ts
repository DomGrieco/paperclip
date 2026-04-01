import { beforeEach, describe, expect, it, vi } from "vitest";
import { hermesBootstrapProfileService } from "../services/hermes-bootstrap-profiles.js";

const mockSecretService = vi.hoisted(() => ({
  resolveSecretTextByName: vi.fn(),
  upsertTextSecretByName: vi.fn(),
  removeByName: vi.fn(),
}));
const mockImportHermesBootstrapFromHome = vi.hoisted(() => vi.fn());
const mockClassifyHermesBootstrap = vi.hoisted(() => vi.fn());

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

vi.mock("../services/hermes-bootstrap.js", () => ({
  importHermesBootstrapFromHome: mockImportHermesBootstrapFromHome,
  classifyHermesBootstrap: mockClassifyHermesBootstrap,
}));

describe("hermesBootstrapProfileService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a stored persisted profile from company secrets", async () => {
    mockSecretService.resolveSecretTextByName
      .mockResolvedValueOnce('{"active_provider":"openai-codex"}\n')
      .mockResolvedValueOnce('OPENAI_API_KEY=test\n')
      .mockResolvedValueOnce('model:\n  default: gpt-5.4\n')
      .mockResolvedValueOnce(
        JSON.stringify({
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
        }) + "\n",
      );
    mockClassifyHermesBootstrap.mockReturnValue({
      payload: {
        authJson: '{"active_provider":"openai-codex"}\n',
        envFile: 'OPENAI_API_KEY=test\n',
        configYaml: 'model:\n  default: gpt-5.4\n',
      },
      summary: {
        sourceHomePath: "paperclip://companies/company-1/hermes-bootstrap-profile",
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

    const svc = hermesBootstrapProfileService({} as any);
    const profile = await svc.getStoredProfile("company-1");

    expect(profile?.summary.sourceHomePath).toBe("/Users/eru/.hermes");
    expect(mockSecretService.resolveSecretTextByName).toHaveBeenCalledTimes(4);
  });

  it("imports a bootstrap profile and persists each payload segment into company secrets", async () => {
    mockImportHermesBootstrapFromHome.mockResolvedValue({
      payload: {
        authJson: '{"active_provider":"openai-codex"}\n',
        envFile: 'OPENAI_API_KEY=test\n',
        configYaml: 'model:\n  default: gpt-5.4\n',
      },
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

    const svc = hermesBootstrapProfileService({} as any);
    const imported = await svc.importFromHome(
      "company-1",
      { homePath: "/Users/eru/.hermes" },
      { userId: "user-1" },
    );

    expect(imported.summary.activeProvider).toBe("openai-codex");
    expect(mockImportHermesBootstrapFromHome).toHaveBeenCalledWith({ homePath: "/Users/eru/.hermes" });
    expect(mockSecretService.upsertTextSecretByName).toHaveBeenCalledTimes(4);
    expect(mockSecretService.removeByName).not.toHaveBeenCalled();
  });
});

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importHermesBootstrapFromHome } from "../services/hermes-bootstrap.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-bootstrap-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("importHermesBootstrapFromHome", () => {
  it("classifies a real Hermes home into summary metadata plus worker payloads", async () => {
    const homePath = await makeTempDir();
    await fs.writeFile(
      path.join(homePath, "auth.json"),
      JSON.stringify(
        {
          version: 1,
          active_provider: "openai-codex",
          providers: {
            "openai-codex": { tokens: { access_token: "secret" } },
            anthropic: { token: "other-secret" },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(homePath, ".env"),
      [
        "OPENROUTER_API_KEY=sk-or-secret",
        "BROWSERBASE_API_KEY=browser-secret",
        "# comment",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(homePath, "config.yaml"),
      [
        "model:",
        "  provider: openai-codex",
        "  default: gpt-5.4",
        "  base_url: https://chatgpt.com/backend-api/codex",
        "terminal:",
        "  backend: local",
        "  cwd: /Users/eru",
        "toolsets:",
        "  - hermes-cli",
        "  - browser",
        "platform_toolsets:",
        "  cli:",
        "    - hermes-cli",
        "  telegram:",
        "    - hermes-telegram",
        "mcp_servers:",
        "  github:",
        "    command: npx",
        "  filesystem:",
        "    command: npx",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await importHermesBootstrapFromHome({ homePath });

    expect(result.summary.sourceHomePath).toBe(homePath);
    expect(result.summary.hasAuthJson).toBe(true);
    expect(result.summary.hasEnvFile).toBe(true);
    expect(result.summary.hasConfigYaml).toBe(true);
    expect(result.summary.activeProvider).toBe("openai-codex");
    expect(result.summary.authProviderIds).toEqual(["anthropic", "openai-codex"]);
    expect(result.summary.configuredProvider).toBe("openai-codex");
    expect(result.summary.defaultModel).toBe("gpt-5.4");
    expect(result.summary.configuredBaseUrl).toBe("https://chatgpt.com/backend-api/codex");
    expect(result.summary.terminalBackend).toBe("local");
    expect(result.summary.terminalCwd).toBe("/Users/eru");
    expect(result.summary.mcpServerNames).toEqual(["filesystem", "github"]);
    expect(result.summary.enabledPlatforms).toEqual(["cli", "telegram"]);
    expect(result.summary.enabledToolsets).toEqual(["hermes-cli", "browser"]);
    expect(result.summary.secretEnvKeys).toEqual(["BROWSERBASE_API_KEY", "OPENROUTER_API_KEY"]);

    expect(result.payload.authJson).toContain('"active_provider": "openai-codex"');
    expect(result.payload.envFile).toContain("OPENROUTER_API_KEY=sk-or-secret");
    expect(result.payload.configYaml).toContain("provider: openai-codex");
  });

  it("tolerates partial Hermes homes and reports absent files cleanly", async () => {
    const homePath = await makeTempDir();
    await fs.writeFile(
      path.join(homePath, "config.yaml"),
      [
        "model:",
        "  provider: custom",
        "  default: local-model",
        "terminal:",
        "  backend: docker",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await importHermesBootstrapFromHome({ homePath });

    expect(result.summary.hasAuthJson).toBe(false);
    expect(result.summary.hasEnvFile).toBe(false);
    expect(result.summary.hasConfigYaml).toBe(true);
    expect(result.summary.activeProvider).toBeNull();
    expect(result.summary.authProviderIds).toEqual([]);
    expect(result.summary.configuredProvider).toBe("custom");
    expect(result.summary.defaultModel).toBe("local-model");
    expect(result.summary.terminalBackend).toBe("docker");
    expect(result.summary.secretEnvKeys).toEqual([]);
    expect(result.payload.authJson).toBeNull();
    expect(result.payload.envFile).toBeNull();
    expect(result.payload.configYaml).toContain("provider: custom");
  });
});

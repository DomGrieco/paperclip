import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureManagedAgentRuntime,
  type AgentManagedRuntimeInfo,
  type AgentManagedRuntimeInstallResult,
  type AgentManagedRuntimeProfile,
  type AgentManagedRuntimeSettings,
  type RunCommand,
} from "../services/agent-managed-runtime.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-agent-managed-runtime-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeRunner(calls: Array<{ command: string; args: string[] }>): RunCommand {
  return async ({ command, args }) => {
    calls.push({ command, args });
    if (args.includes("--version")) {
      return { stdout: "Fake Agent v1.2.3\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
}

function makeProfile(channelRootFactory: (channel: string) => string): AgentManagedRuntimeProfile {
  return {
    adapterType: "fake_local",
    provider: "managed_runtime_cache",
    resolveSettings(config): AgentManagedRuntimeSettings {
      const explicit =
        typeof config.managedRuntime === "object" && config.managedRuntime !== null
          ? (config.managedRuntime as Record<string, unknown>)
          : {};
      return {
        enabled: explicit.autoUpdate !== false,
        channel: typeof explicit.channel === "string" ? explicit.channel : "stable",
        source: typeof explicit.source === "string" ? explicit.source : "git+https://example.com/fake-agent.git",
        refreshIntervalMinutes:
          typeof explicit.refreshIntervalMinutes === "number" ? explicit.refreshIntervalMinutes : 60,
      };
    },
    resolveChannelRoot: channelRootFactory,
    resolveMetadataPath(channel, channelRoot) {
      return path.join(channelRoot ?? channelRootFactory(channel), "metadata.json");
    },
    async installRuntime({ channelRoot, settings, now }): Promise<AgentManagedRuntimeInstallResult> {
      const installRoot = path.join(channelRoot, "installs", now.toISOString().replace(/[:.]/g, "-"));
      const commandPath = path.join(installRoot, "bin", "fake-agent");
      await fs.mkdir(path.dirname(commandPath), { recursive: true });
      await fs.writeFile(commandPath, "#!/bin/sh\n", { mode: 0o755 });
      return {
        installRoot,
        commandPath,
        version: "Fake Agent v1.2.3",
        extraFields: {
          helperCommand: path.join(installRoot, "bin", "helper"),
          sourceEcho: settings.source,
        },
      };
    },
    deserializeMetadata(value): AgentManagedRuntimeInfo | null {
      if (!value || typeof value !== "object") return null;
      const parsed = value as Record<string, unknown>;
      if (
        parsed.schemaVersion !== "v1" ||
        typeof parsed.adapterType !== "string" ||
        typeof parsed.provider !== "string" ||
        typeof parsed.channel !== "string" ||
        typeof parsed.source !== "string" ||
        typeof parsed.installRoot !== "string" ||
        typeof parsed.commandPath !== "string" ||
        typeof parsed.version !== "string" ||
        typeof parsed.checkedAt !== "string" ||
        typeof parsed.updatedAt !== "string" ||
        typeof parsed.refreshIntervalMinutes !== "number"
      ) {
        return null;
      }
      return parsed as AgentManagedRuntimeInfo;
    },
  };
}

describe("ensureManagedAgentRuntime", () => {
  it("installs a managed runtime and persists generic metadata", async () => {
    const root = await makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];
    const profile = makeProfile((channel) => path.join(root, channel));

    const result = await ensureManagedAgentRuntime({
      profile,
      now: new Date("2026-03-31T19:00:00.000Z"),
      runCommand: makeRunner(calls),
      config: {
        managedRuntime: {
          channel: "preview",
          source: "git+https://example.com/fake-agent.git@preview",
          refreshIntervalMinutes: 30,
        },
      },
    });

    expect(result.refreshed).toBe(true);
    expect(result.adapterType).toBe("fake_local");
    expect(result.provider).toBe("managed_runtime_cache");
    expect(result.channel).toBe("preview");
    expect(result.source).toBe("git+https://example.com/fake-agent.git@preview");
    expect(result.commandPath).toContain(path.join("installs", "2026-03-31T19-00-00-000Z", "bin", "fake-agent"));
    expect(result.helperCommand).toContain(path.join("installs", "2026-03-31T19-00-00-000Z", "bin", "helper"));

    const metadata = JSON.parse(
      await fs.readFile(path.join(root, "preview", "metadata.json"), "utf8"),
    ) as AgentManagedRuntimeInfo;
    expect(metadata.adapterType).toBe("fake_local");
    expect(metadata.provider).toBe("managed_runtime_cache");
    expect(metadata.commandPath).toBe(result.commandPath);
    expect(metadata.sourceEcho).toBe("git+https://example.com/fake-agent.git@preview");
    expect(calls).toEqual([]);
  });

  it("reuses a fresh managed runtime without reinstalling and only performs a functional check", async () => {
    const root = await makeTempDir();
    const profile = makeProfile((channel) => path.join(root, channel));
    const initial = await ensureManagedAgentRuntime({
      profile,
      now: new Date("2026-03-31T19:00:00.000Z"),
      runCommand: makeRunner([]),
      config: {},
    });

    const calls: Array<{ command: string; args: string[] }> = [];
    const reused = await ensureManagedAgentRuntime({
      profile,
      now: new Date("2026-03-31T19:30:00.000Z"),
      runCommand: makeRunner(calls),
      config: {},
    });

    expect(reused.refreshed).toBe(false);
    expect(reused.installRoot).toBe(initial.installRoot);
    expect(reused.checkedAt).toBe("2026-03-31T19:30:00.000Z");
    expect(calls).toEqual([
      {
        command: initial.commandPath,
        args: ["--version"],
      },
    ]);
  });

  it("reinstalls when the stored managed runtime command is no longer functional", async () => {
    const root = await makeTempDir();
    const profile = makeProfile((channel) => path.join(root, channel));
    const first = await ensureManagedAgentRuntime({
      profile,
      now: new Date("2026-03-31T19:00:00.000Z"),
      runCommand: makeRunner([]),
      config: {},
    });

    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = makeRunner(calls);
    const refreshed = await ensureManagedAgentRuntime({
      profile,
      now: new Date("2026-03-31T19:10:00.000Z"),
      runCommand: async (input) => {
        if (input.command === first.commandPath && input.args.length === 1 && input.args[0] === "--version") {
          throw new Error("broken fake managed runtime");
        }
        return runner(input);
      },
      config: {},
    });

    expect(refreshed.refreshed).toBe(true);
    expect(refreshed.installRoot).not.toBe(first.installRoot);
  });
});

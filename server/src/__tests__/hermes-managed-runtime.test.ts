import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureManagedHermesRuntime,
  type HermesManagedRuntimeResolution,
} from "../services/hermes-managed-runtime.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-managed-runtime-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeRunner(calls: Array<{ command: string; args: string[] }>) {
  return async ({ command, args }: { command: string; args: string[] }) => {
    calls.push({ command, args });
    if (command === "python3" && args[0] === "-m" && args[1] === "venv") {
      const venvRoot = args[2]!;
      await fs.mkdir(path.join(venvRoot, "bin"), { recursive: true });
      await fs.writeFile(path.join(venvRoot, "bin", "python"), "#!/bin/sh\n", { mode: 0o755 });
      await fs.writeFile(path.join(venvRoot, "bin", "hermes"), "#!/bin/sh\n", { mode: 0o755 });
      return { stdout: "", stderr: "" };
    }
    if (args.includes("--version")) {
      return { stdout: "Hermes Agent v9.9.9\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
}

describe("ensureManagedHermesRuntime", () => {
  it("installs Hermes into a managed runtime cache and persists metadata", async () => {
    const channelRoot = await makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await ensureManagedHermesRuntime({
      channelRoot,
      now: new Date("2026-03-29T23:00:00.000Z"),
      runCommand: makeRunner(calls),
      config: {},
    });

    expect(result.refreshed).toBe(true);
    expect(result.channel).toBe("stable");
    expect(result.version).toBe("Hermes Agent v9.9.9");
    expect(result.hermesCommand).toContain(path.join("venv", "bin", "hermes"));
    expect(result.installRoot).toContain(path.join("installs", "2026-03-29T23-00-00-000Z"));
    expect(await fs.stat(result.hermesCommand)).toBeTruthy();

    const metadata = JSON.parse(await fs.readFile(path.join(channelRoot, "metadata.json"), "utf8")) as HermesManagedRuntimeResolution;
    expect(metadata.version).toBe("Hermes Agent v9.9.9");
    expect(metadata.installRoot).toBe(result.installRoot);
    expect(calls.map((entry) => `${entry.command} ${entry.args.join(" ")}`)).toEqual([
      expect.stringContaining("python3 -m venv"),
      expect.stringContaining("bin/python -m pip install --upgrade pip setuptools wheel"),
      expect.stringContaining("bin/python -m pip install --upgrade git+https://github.com/NousResearch/hermes-agent.git"),
      expect.stringContaining("bin/hermes --version"),
    ]);
  });

  it("reuses a fresh managed runtime without reinstalling and updates checkedAt", async () => {
    const channelRoot = await makeTempDir();
    const firstCalls: Array<{ command: string; args: string[] }> = [];
    const secondCalls: Array<{ command: string; args: string[] }> = [];

    const first = await ensureManagedHermesRuntime({
      channelRoot,
      now: new Date("2026-03-29T23:00:00.000Z"),
      runCommand: makeRunner(firstCalls),
      config: {},
    });

    const second = await ensureManagedHermesRuntime({
      channelRoot,
      now: new Date("2026-03-30T00:00:00.000Z"),
      runCommand: makeRunner(secondCalls),
      config: {},
    });

    expect(first.refreshed).toBe(true);
    expect(second.refreshed).toBe(false);
    expect(second.installRoot).toBe(first.installRoot);
    expect(second.checkedAt).toBe("2026-03-30T00:00:00.000Z");
    expect(secondCalls).toHaveLength(0);
  });

  it("refreshes a stale runtime when the refresh interval has elapsed", async () => {
    const channelRoot = await makeTempDir();
    const firstCalls: Array<{ command: string; args: string[] }> = [];
    const refreshCalls: Array<{ command: string; args: string[] }> = [];

    const first = await ensureManagedHermesRuntime({
      channelRoot,
      now: new Date("2026-03-29T00:00:00.000Z"),
      runCommand: makeRunner(firstCalls),
      config: {
        hermesManagedRuntimeRefreshIntervalMinutes: 60,
      },
    });

    const refreshed = await ensureManagedHermesRuntime({
      channelRoot,
      now: new Date("2026-03-29T02:30:00.000Z"),
      runCommand: makeRunner(refreshCalls),
      config: {
        hermesManagedRuntimeRefreshIntervalMinutes: 60,
      },
    });

    expect(refreshed.refreshed).toBe(true);
    expect(refreshed.installRoot).not.toBe(first.installRoot);
    expect(refreshCalls.length).toBeGreaterThan(0);
  });

  it("honors channel/source overrides from config", async () => {
    const channelRoot = await makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await ensureManagedHermesRuntime({
      channelRoot,
      now: new Date("2026-03-29T23:00:00.000Z"),
      runCommand: makeRunner(calls),
      config: {
        managedRuntime: {
          channel: "canary",
          source: "git+https://github.com/NousResearch/hermes-agent.git@main",
          refreshIntervalMinutes: 30,
        },
      },
    });

    expect(result.channel).toBe("canary");
    expect(result.source).toBe("git+https://github.com/NousResearch/hermes-agent.git@main");
    expect(result.refreshIntervalMinutes).toBe(30);
    expect(calls.some((entry) => entry.args.includes("git+https://github.com/NousResearch/hermes-agent.git@main"))).toBe(true);
  });
});

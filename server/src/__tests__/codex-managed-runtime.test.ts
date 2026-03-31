import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureManagedCodexRuntime,
  type CodexManagedRuntimeResolution,
} from "../services/codex-managed-runtime.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-managed-runtime-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeRunner(calls: Array<{ command: string; args: string[] }>) {
  return async ({ command, args }: { command: string; args: string[] }) => {
    calls.push({ command, args });
    if (command === "npm" && args[0] === "install") {
      const prefixIndex = args.indexOf("--prefix");
      const installRoot = args[prefixIndex + 1]!;
      const binDir = path.join(installRoot, "bin");
      await fs.mkdir(binDir, { recursive: true });
      await fs.writeFile(path.join(binDir, "codex"), "#!/bin/sh\necho Codex CLI 1.2.3\n", { mode: 0o755 });
      return { stdout: "", stderr: "" };
    }
    if (args.includes("--version")) {
      return { stdout: "Codex CLI 1.2.3\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
}

describe("ensureManagedCodexRuntime", () => {
  it("installs Codex into a managed runtime cache and persists metadata", async () => {
    const channelRoot = await makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await ensureManagedCodexRuntime({
      channelRoot,
      now: new Date("2026-03-31T22:00:00.000Z"),
      runCommand: makeRunner(calls),
      config: {},
    });

    expect(result.refreshed).toBe(true);
    expect(result.channel).toBe("stable");
    expect(result.version).toBe("Codex CLI 1.2.3");
    expect(result.commandPath).toContain(path.join("bin", "codex"));
    expect(result.installRoot).toContain(path.join("installs", "2026-03-31T22-00-00-000Z"));
    expect(await fs.stat(result.commandPath)).toBeTruthy();

    const metadata = JSON.parse(await fs.readFile(path.join(channelRoot, "metadata.json"), "utf8")) as CodexManagedRuntimeResolution;
    expect(metadata.version).toBe("Codex CLI 1.2.3");
    expect(metadata.installRoot).toBe(result.installRoot);
    expect(calls.map((entry) => `${entry.command} ${entry.args.join(" ")}`)).toEqual([
      expect.stringContaining("npm install --global --prefix"),
      expect.stringContaining("bin/codex --version"),
    ]);
  });

  it("reuses a fresh managed runtime without reinstalling and updates checkedAt", async () => {
    const channelRoot = await makeTempDir();
    const firstCalls: Array<{ command: string; args: string[] }> = [];
    const secondCalls: Array<{ command: string; args: string[] }> = [];

    const first = await ensureManagedCodexRuntime({
      channelRoot,
      now: new Date("2026-03-31T22:00:00.000Z"),
      runCommand: makeRunner(firstCalls),
      config: {},
    });

    const second = await ensureManagedCodexRuntime({
      channelRoot,
      now: new Date("2026-03-31T22:30:00.000Z"),
      runCommand: makeRunner(secondCalls),
      config: {},
    });

    expect(second.refreshed).toBe(false);
    expect(second.installRoot).toBe(first.installRoot);
    expect(second.checkedAt).toBe("2026-03-31T22:30:00.000Z");
    expect(secondCalls).toEqual([{ command: first.commandPath, args: ["--version"] }]);
  });

  it("reinstalls when the stored Codex command is no longer functional", async () => {
    const channelRoot = await makeTempDir();
    const first = await ensureManagedCodexRuntime({
      channelRoot,
      now: new Date("2026-03-31T22:00:00.000Z"),
      runCommand: makeRunner([]),
      config: {},
    });

    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = makeRunner(calls);
    const refreshed = await ensureManagedCodexRuntime({
      channelRoot,
      now: new Date("2026-03-31T22:10:00.000Z"),
      runCommand: async (input) => {
        if (input.command === first.commandPath && input.args.length === 1 && input.args[0] === "--version") {
          throw new Error("broken Codex command");
        }
        return await runner(input);
      },
      config: {},
    });

    expect(refreshed.refreshed).toBe(true);
    expect(refreshed.installRoot).not.toBe(first.installRoot);
  });
});

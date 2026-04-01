import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureManagedCursorRuntime,
  type CursorManagedRuntimeResolution,
} from "../services/cursor-managed-runtime.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-cursor-managed-runtime-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeRunner(calls: Array<{ command: string; args: string[] }>) {
  return async ({ command, args }: { command: string; args: string[] }) => {
    calls.push({ command, args });
    if (command === "sh" && args[0] === "-lc") {
      const script = args[1] ?? "";
      const homeMatch = script.match(/export HOME="([^"]+)"/);
      const installRoot = homeMatch?.[1];
      if (!installRoot) {
        throw new Error(`missing HOME export in install script: ${script}`);
      }
      const binDir = path.join(installRoot, ".local", "bin");
      await fs.mkdir(binDir, { recursive: true });
      await fs.writeFile(path.join(binDir, "agent"), "#!/bin/sh\necho Cursor CLI 1.2.3\n", { mode: 0o755 });
      return { stdout: "", stderr: "" };
    }
    if (args.includes("--version")) {
      return { stdout: "Cursor CLI 1.2.3\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
}

describe("ensureManagedCursorRuntime", () => {
  it("installs Cursor into a managed runtime cache and persists metadata", async () => {
    const channelRoot = await makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await ensureManagedCursorRuntime({
      channelRoot,
      now: new Date("2026-03-31T22:00:00.000Z"),
      runCommand: makeRunner(calls),
      config: {},
    });

    expect(result.refreshed).toBe(true);
    expect(result.channel).toBe("stable");
    expect(result.version).toBe("Cursor CLI 1.2.3");
    expect(result.commandPath).toContain(path.join(".local", "bin", "agent"));
    expect(result.installRoot).toContain("install-home");
    expect(await fs.stat(result.commandPath)).toBeTruthy();

    const metadata = JSON.parse(
      await fs.readFile(path.join(channelRoot, "metadata.json"), "utf8"),
    ) as CursorManagedRuntimeResolution;
    expect(metadata.version).toBe("Cursor CLI 1.2.3");
    expect(metadata.installRoot).toBe(result.installRoot);
    expect(calls.map((entry) => `${entry.command} ${entry.args.join(" ")}`)).toEqual([
      expect.stringContaining("sh -lc export HOME="),
      expect.stringContaining(".local/bin/agent --version"),
    ]);
  });

  it("reuses a fresh managed runtime without reinstalling and updates checkedAt", async () => {
    const channelRoot = await makeTempDir();
    const firstCalls: Array<{ command: string; args: string[] }> = [];
    const secondCalls: Array<{ command: string; args: string[] }> = [];

    const first = await ensureManagedCursorRuntime({
      channelRoot,
      now: new Date("2026-03-31T22:00:00.000Z"),
      runCommand: makeRunner(firstCalls),
      config: {},
    });

    const second = await ensureManagedCursorRuntime({
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

  it("reinstalls when the stored Cursor command is no longer functional", async () => {
    const channelRoot = await makeTempDir();
    const first = await ensureManagedCursorRuntime({
      channelRoot,
      now: new Date("2026-03-31T22:00:00.000Z"),
      runCommand: makeRunner([]),
      config: {},
    });

    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = makeRunner(calls);
    let failedHealthCheck = false;
    const refreshed = await ensureManagedCursorRuntime({
      channelRoot,
      now: new Date("2026-03-31T22:10:00.000Z"),
      runCommand: async (input) => {
        if (
          !failedHealthCheck &&
          input.command === first.commandPath &&
          input.args.length === 1 &&
          input.args[0] === "--version"
        ) {
          failedHealthCheck = true;
          throw new Error("broken Cursor command");
        }
        return await runner(input);
      },
      config: {},
    });

    expect(refreshed.refreshed).toBe(true);
    expect(refreshed.installRoot).toBe(first.installRoot);
    expect(calls[0]?.command).toBe("sh");
  });
});

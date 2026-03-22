import { describe, expect, it } from "vitest";
import { resolveExecutionCwd } from "@paperclipai/adapter-utils/server-utils";

describe("resolveExecutionCwd", () => {
  it("prefers the Paperclip-resolved workspace over stale adapter cwd config", () => {
    expect(
      resolveExecutionCwd({
        workspaceCwd: "/paperclip/instances/default/workspaces/agent-1",
        configuredCwd: "/app",
        defaultCwd: "/workspace",
      }),
    ).toBe("/paperclip/instances/default/workspaces/agent-1");
  });

  it("falls back to adapter cwd config when no workspace cwd is available", () => {
    expect(
      resolveExecutionCwd({
        workspaceCwd: "",
        configuredCwd: "/workspace",
        defaultCwd: "/tmp/default",
      }),
    ).toBe("/workspace");
  });

  it("falls back to the process cwd when neither workspace nor adapter cwd is configured", () => {
    expect(
      resolveExecutionCwd({
        workspaceCwd: "",
        configuredCwd: "",
        defaultCwd: "/tmp/default",
      }),
    ).toBe("/tmp/default");
  });
});

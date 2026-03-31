import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveAdapterRuntimeCacheRoot,
  resolveAdapterRuntimeChannelMetadataPath,
  resolveAdapterRuntimeChannelRoot,
  resolveAgentRuntimeHomeRoot,
  resolveCompanySharedArtifactsRoot,
  resolveCompanySharedContextRoot,
  resolveCompanySharedMemoryRoot,
  resolveCompanySharedRuntimeRoot,
  resolveCompanySharedSkillsRoot,
} from "../home-paths.js";

afterEach(() => {
  delete process.env.PAPERCLIP_HOME;
  delete process.env.PAPERCLIP_INSTANCE_ID;
});

describe("runtime path helpers", () => {
  it("builds sanitized company shared roots under the instance root", () => {
    process.env.PAPERCLIP_HOME = "/tmp/paperclip-home";
    process.env.PAPERCLIP_INSTANCE_ID = "runtime-test";

    expect(resolveCompanySharedRuntimeRoot("  Company / Name  ")).toBe(
      path.resolve(
        "/tmp/paperclip-home",
        "instances",
        "runtime-test",
        "companies",
        "Company-Name",
        "shared",
      ),
    );
    expect(resolveCompanySharedSkillsRoot("  Company / Name  ")).toBe(
      path.resolve(
        "/tmp/paperclip-home",
        "instances",
        "runtime-test",
        "companies",
        "Company-Name",
        "shared",
        "managed-skills",
      ),
    );
    expect(resolveCompanySharedContextRoot("  Company / Name  ")).toBe(
      path.resolve(
        "/tmp/paperclip-home",
        "instances",
        "runtime-test",
        "companies",
        "Company-Name",
        "shared",
        "context",
      ),
    );
    expect(resolveCompanySharedMemoryRoot("  Company / Name  ")).toBe(
      path.resolve(
        "/tmp/paperclip-home",
        "instances",
        "runtime-test",
        "companies",
        "Company-Name",
        "shared",
        "memory",
      ),
    );
    expect(resolveCompanySharedArtifactsRoot("  Company / Name  ")).toBe(
      path.resolve(
        "/tmp/paperclip-home",
        "instances",
        "runtime-test",
        "companies",
        "Company-Name",
        "shared",
        "artifacts",
      ),
    );
  });

  it("builds sanitized adapter-specific agent home roots", () => {
    process.env.PAPERCLIP_HOME = "/tmp/paperclip-home";
    process.env.PAPERCLIP_INSTANCE_ID = "runtime-test";

    expect(resolveAgentRuntimeHomeRoot("Company / Name", "agent 01/root", "cursor_local")).toBe(
      path.resolve(
        "/tmp/paperclip-home",
        "instances",
        "runtime-test",
        "companies",
        "Company-Name",
        "agents",
        "agent-01-root",
        "homes",
        "cursor_local",
      ),
    );
  });

  it("builds adapter runtime cache roots and channel metadata paths", () => {
    process.env.PAPERCLIP_HOME = "~/paperclip-home";
    process.env.PAPERCLIP_INSTANCE_ID = "runtime-test";

    const instanceRoot = path.resolve(os.homedir(), "paperclip-home", "instances", "runtime-test");

    expect(resolveAdapterRuntimeCacheRoot("codex_local")).toBe(
      path.resolve(instanceRoot, "runtime-cache", "codex_local"),
    );
    expect(resolveAdapterRuntimeChannelRoot("codex_local", " Stable / Preview ")).toBe(
      path.resolve(instanceRoot, "runtime-cache", "codex_local", "channels", "Stable-Preview"),
    );
    expect(resolveAdapterRuntimeChannelMetadataPath("codex_local", " Stable / Preview ")).toBe(
      path.resolve(
        instanceRoot,
        "runtime-cache",
        "codex_local",
        "channels",
        "Stable-Preview",
        "metadata.json",
      ),
    );
  });

  it("rejects blank company ids for company and agent runtime roots", () => {
    expect(() => resolveCompanySharedRuntimeRoot("   ")).toThrow(
      "Company shared runtime path requires companyId.",
    );
    expect(() => resolveAgentRuntimeHomeRoot("   ", "agent-1", "hermes")).toThrow(
      "Agent runtime home path requires companyId and agentId.",
    );
  });

  it("rejects blank agent ids for agent runtime home roots", () => {
    expect(() => resolveAgentRuntimeHomeRoot("company-1", "   ", "hermes")).toThrow(
      "Agent runtime home path requires companyId and agentId.",
    );
  });
});

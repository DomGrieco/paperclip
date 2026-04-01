import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.unstubAllEnvs();
});

describe("home-path runtime persistence helpers", () => {
  it("builds company shared runtime paths under the Paperclip instance root", () => {
    vi.stubEnv("PAPERCLIP_HOME", "/tmp/paperclip-home");
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "instance-123");

    const companyRoot = path.join(
      "/tmp/paperclip-home",
      "instances",
      "instance-123",
      "companies",
      "Acme-Co",
      "shared",
    );

    expect(resolveCompanySharedRuntimeRoot("Acme Co")).toBe(companyRoot);
    expect(resolveCompanySharedSkillsRoot("Acme Co")).toBe(path.join(companyRoot, "managed-skills"));
    expect(resolveCompanySharedContextRoot("Acme Co")).toBe(path.join(companyRoot, "context"));
    expect(resolveCompanySharedMemoryRoot("Acme Co")).toBe(path.join(companyRoot, "memory"));
    expect(resolveCompanySharedArtifactsRoot("Acme Co")).toBe(path.join(companyRoot, "artifacts"));
  });

  it("builds agent runtime home paths with sanitized company, agent, and adapter segments", () => {
    vi.stubEnv("PAPERCLIP_HOME", "/tmp/paperclip-home");
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "instance-123");

    expect(resolveAgentRuntimeHomeRoot("Acme Co", "Agent Alpha/1", "codex local")).toBe(
      path.join(
        "/tmp/paperclip-home",
        "instances",
        "instance-123",
        "companies",
        "Acme-Co",
        "agents",
        "Agent-Alpha-1",
        "homes",
        "codex-local",
      ),
    );
  });

  it("builds adapter runtime cache, channel, and metadata paths with sanitized segments", () => {
    vi.stubEnv("PAPERCLIP_HOME", "/tmp/paperclip-home");
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "instance-123");

    const cacheRoot = path.join(
      "/tmp/paperclip-home",
      "instances",
      "instance-123",
      "runtime-cache",
      "cursor-beta",
    );
    const channelRoot = path.join(cacheRoot, "channels", "nightly-canary");

    expect(resolveAdapterRuntimeCacheRoot("cursor beta")).toBe(cacheRoot);
    expect(resolveAdapterRuntimeChannelRoot("cursor beta", "nightly/canary")).toBe(channelRoot);
    expect(resolveAdapterRuntimeChannelMetadataPath("cursor beta", "nightly/canary")).toBe(
      path.join(channelRoot, "metadata.json"),
    );
  });

  it("falls back to stable for blank runtime channels", () => {
    vi.stubEnv("PAPERCLIP_HOME", "/tmp/paperclip-home");
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "instance-123");

    expect(resolveAdapterRuntimeChannelRoot("hermes", "   ")).toBe(
      path.join(
        "/tmp/paperclip-home",
        "instances",
        "instance-123",
        "runtime-cache",
        "hermes",
        "channels",
        "stable",
      ),
    );
  });

  it("rejects missing identifiers for company, agent, and adapter paths", () => {
    vi.stubEnv("PAPERCLIP_HOME", "/tmp/paperclip-home");
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "instance-123");

    expect(() => resolveCompanySharedRuntimeRoot("   ")).toThrow("Company shared runtime path requires companyId.");
    expect(() => resolveAgentRuntimeHomeRoot("acme", "   ", "codex")).toThrow(
      "Agent runtime home path requires companyId and agentId.",
    );
    expect(() => resolveAdapterRuntimeCacheRoot("   ")).toThrow("adapterType path requires adapterType.");
  });
});

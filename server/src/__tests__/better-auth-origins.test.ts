import { describe, expect, it } from "vitest";
import type { Config } from "../config.js";
import { deriveAuthTrustedOrigins } from "../auth/better-auth.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    host: "0.0.0.0",
    port: 3100,
    allowedHostnames: ["localhost"],
    authBaseUrlMode: "explicit",
    authPublicBaseUrl: "http://localhost:3100",
    authDisableSignUp: false,
    databaseMode: "postgres",
    databaseUrl: "postgres://paperclip:paperclip@db:5432/paperclip",
    embeddedPostgresDataDir: "/tmp/paperclip-db",
    embeddedPostgresPort: 54329,
    databaseBackupEnabled: false,
    databaseBackupIntervalMinutes: 60,
    databaseBackupRetentionDays: 30,
    databaseBackupDir: "/tmp/paperclip-backups",
    serveUi: true,
    uiDevMiddleware: false,
    secretsProvider: "local_encrypted",
    secretsStrictMode: false,
    secretsMasterKeyFilePath: "/tmp/paperclip-master.key",
    storageProvider: "local_disk",
    storageLocalDiskBaseDir: "/tmp/paperclip-storage",
    storageS3Bucket: "paperclip",
    storageS3Region: "us-east-1",
    storageS3Endpoint: undefined,
    storageS3Prefix: "",
    storageS3ForcePathStyle: false,
    heartbeatSchedulerEnabled: true,
    heartbeatSchedulerIntervalMs: 30000,
    companyDeletionEnabled: false,
    ...overrides,
  };
}

describe("deriveAuthTrustedOrigins", () => {
  it("includes loopback alternatives for a localhost public URL", () => {
    const origins = deriveAuthTrustedOrigins(
      makeConfig({
        authPublicBaseUrl: "http://localhost:3100",
        allowedHostnames: ["localhost"],
      }),
    );

    expect(origins).toContain("http://localhost:3100");
    expect(origins).toContain("http://localhost");
    expect(origins).toContain("http://127.0.0.1:3100");
    expect(origins).toContain("http://127.0.0.1");
  });

  it("includes localhost alternatives for a 127.0.0.1 public URL", () => {
    const origins = deriveAuthTrustedOrigins(
      makeConfig({
        authPublicBaseUrl: "http://127.0.0.1:3100",
        allowedHostnames: ["127.0.0.1"],
      }),
    );

    expect(origins).toContain("http://127.0.0.1:3100");
    expect(origins).toContain("http://127.0.0.1");
    expect(origins).toContain("http://localhost:3100");
    expect(origins).toContain("http://localhost");
  });
});

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  issues,
  projects,
} from "@paperclipai/db";
import { resolveRuntimeBundle } from "../services/runtime-bundle.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

const tempPaths: string[] = [];
const runningInstances: EmbeddedPostgresInstance[] = [];

async function getEmbeddedPostgresCtor(): Promise<EmbeddedPostgresCtor> {
  const mod = await import("embedded-postgres");
  return mod.default as EmbeddedPostgresCtor;
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate test port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function createTempDatabase(): Promise<string> {
  const EmbeddedPostgres = await getEmbeddedPostgresCtor();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-runtime-bundle-"));
  tempPaths.push(dataDir);

  const port = await getAvailablePort();
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password: "paperclip",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  await instance.initialise();
  await instance.start();
  runningInstances.push(instance);

  const adminUrl = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
  await ensurePostgresDatabase(adminUrl, "paperclip");
  return `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
}

afterEach(async () => {
  while (runningInstances.length > 0) {
    const instance = runningInstances.pop();
    if (!instance) continue;
    await instance.stop();
  }

  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (!tempPath) continue;
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("resolveRuntimeBundle", () => {
  it("resolves task, project, policy, and memory recall into a worker startup bundle", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [project] = await db.insert(projects).values({
      companyId: company.id,
      name: "Runtime Bundle Project",
      status: "in_progress",
      executionWorkspacePolicy: {
        defaultMode: "isolated_workspace",
        workspaceStrategy: { type: "git_worktree" },
      },
    }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      projectId: project.id,
      name: "Worker",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      projectId: project.id,
      title: "Build runtime bundle",
      description: "Remember the issue operating context.",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
    }).returning();

    const bundle = await resolveRuntimeBundle(db, {
      companyId: company.id,
      issueId: issue.id,
      agentId: agent.id,
      runId: "run-1",
      runtime: "codex",
    });

    expect(bundle.issue?.id).toBe(issue.id);
    expect(bundle.project?.id).toBe(project.id);
    expect(bundle.policy.tddMode).toBe("required");
    expect(bundle.policy.evidencePolicy).toBe("code_ci_evaluator_summary");
    expect(bundle.runner).toEqual({
      target: "local_host",
      provider: "local_process",
      workspaceStrategyType: "git_worktree",
      executionMode: "isolated_workspace",
      browserCapable: false,
      sandboxed: false,
      isolationBoundary: "host_process",
    });
    expect(bundle.memory.snippets).toEqual([
      {
        scope: "issue",
        source: "issue.description",
        sourceId: issue.id,
        content: "Remember the issue operating context.",
        freshness: "static",
        updatedAt: expect.any(String),
        rank: 1,
      },
    ]);
    expect(bundle.projection.runtime).toBe("codex");
  }, 20_000);

  it("carries issue-level evidence policy overrides into the runtime bundle policy block", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);

    const db = createDb(connectionString);

    const [company] = await db.insert(companies).values({ name: "Paperclip", issuePrefix: "TST" }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Worker",
      role: "engineer",
      adapterType: "opencode_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id,
      title: "Respect evidence override",
      description: "The worker should see the strict evidence policy.",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent.id,
      evidencePolicy: "code_ci_evaluator_summary_artifacts",
      evidencePolicySource: "issue_override",
    }).returning();

    const bundle = await resolveRuntimeBundle(db, {
      companyId: company.id,
      issueId: issue.id,
      agentId: agent.id,
      runtime: "opencode",
    });

    expect(bundle.policy).toEqual({
      tddMode: "required",
      evidencePolicy: "code_ci_evaluator_summary_artifacts",
      evidencePolicySource: "issue_override",
    });
    expect(bundle.runner).toEqual({
      target: "local_host",
      provider: "local_process",
      workspaceStrategyType: null,
      executionMode: null,
      browserCapable: false,
      sandboxed: false,
      isolationBoundary: "host_process",
    });
    expect(bundle.memory.snippets).toEqual([
      {
        scope: "issue",
        source: "issue.description",
        sourceId: issue.id,
        content: "The worker should see the strict evidence policy.",
        freshness: "static",
        updatedAt: expect.any(String),
        rank: 1,
      },
    ]);
  }, 20_000);
});

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-planner-evidence-guard-"));
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
    if (instance) await instance.stop();
  }
  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (tempPath) fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

async function seedScenario() {
  const connectionString = await createTempDatabase();
  await applyPendingMigrations(connectionString);
  const db = createDb(connectionString);

  const companyId = "215e1a5e-bd47-4a3a-9fef-d52a493c683a";
  const plannerAgentId = "b1178794-4491-45da-9a2d-64db0dedd34d";
  const engineerAgentId = "c45b5efe-f685-49e6-a244-016df39b08d0";
  const rootRunId = "37a470a3-1901-45bb-953e-77ec240dd0b0";
  const issueId = "3084b1bb-9eb2-4dd6-a85d-efe9843244ba";

  await db.insert(companies).values({
    id: companyId,
    name: "Paperclip Internal Dogfood",
    issuePrefix: "PAP",
    issueCounter: 21,
  });

  await db.insert(agents).values([
    {
      id: plannerAgentId,
      companyId,
      name: "Hermes CEO",
      role: "ceo",
      adapterType: "hermes_local",
      status: "idle",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    },
    {
      id: engineerAgentId,
      companyId,
      name: "Hermes Engineer",
      role: "general",
      adapterType: "hermes_local",
      status: "idle",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    },
  ]);

  await db.insert(heartbeatRuns).values({
    id: rootRunId,
    companyId,
    agentId: plannerAgentId,
    invocationSource: "assignment",
    triggerDetail: "system",
    status: "running",
    runType: "planner",
    rootRunId,
    parentRunId: null,
    graphDepth: 0,
    repairAttempt: 0,
    contextSnapshot: { issueId, role: "planner_root" },
  });

  await db.insert(issues).values({
    id: issueId,
    companyId,
    title: "Planner-grade validation after managed-runtime command-path fix",
    description:
      "Run a fresh planner-grade validation. Delegate at least two concrete child workstreams when appropriate. Use Hermes Engineer to verify runtime evidence and use Hermes QA to verify browser-visible evidence.",
    status: "in_progress",
    priority: "high",
    assigneeAgentId: plannerAgentId,
    createdByAgentId: plannerAgentId,
    checkoutRunId: rootRunId,
    executionRunId: rootRunId,
    issueNumber: 21,
    identifier: "PAP-21",
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId: plannerAgentId,
      companyId,
      runId: rootRunId,
    };
    next();
  });
  app.use("/api", issueRoutes(db as never, {} as never));
  app.use(errorHandler);

  return { app, db, ids: { companyId, plannerAgentId, engineerAgentId, rootRunId, issueId } };
}

describe("planner evidence guard on issue routes", () => {
  it("blocks planner runs from marking delegated validation issues done without child runs", async () => {
    const { app, db, ids } = await seedScenario();

    const res = await request(app)
      .patch(`/api/issues/${ids.issueId}`)
      .send({ status: "done" });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("cannot be marked done");

    const issue = await db.query.issues.findFirst({ where: (table, { eq }) => eq(table.id, ids.issueId) });
    expect(issue?.status).toBe("in_progress");
  }, 20000);

  it("blocks delegated validation comments before delegated child runs exist", async () => {
    const { app, db, ids } = await seedScenario();

    const res = await request(app)
      .post(`/api/issues/${ids.issueId}/comments`)
      .send({ body: "Hermes Engineer validation: planner root exists and Hermes QA validation matches browser evidence." });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("cannot claim delegated evidence");

    const comments = await db.select().from(issueComments);
    expect(comments).toHaveLength(0);
  }, 20000);

  it("allows completion once planner child-run evidence exists", async () => {
    const { app, db, ids } = await seedScenario();

    await db.insert(heartbeatRuns).values({
      id: "9f63c5ae-a466-4d2d-a894-f36dc43bd8f8",
      companyId: ids.companyId,
      agentId: ids.engineerAgentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "succeeded",
      runType: "worker",
      rootRunId: ids.rootRunId,
      parentRunId: ids.rootRunId,
      graphDepth: 1,
      repairAttempt: 0,
      contextSnapshot: { issueId: ids.issueId, role: "worker" },
    });

    const res = await request(app)
      .patch(`/api/issues/${ids.issueId}`)
      .send({ status: "done", comment: "Hermes Engineer validation is attached and delegated evidence now exists." });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("done");

    const comments = await db.select().from(issueComments);
    expect(comments).toHaveLength(1);
  }, 20000);
});

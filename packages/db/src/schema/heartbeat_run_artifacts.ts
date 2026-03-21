import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { companies } from "./companies.js";
import { documents } from "./documents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issueWorkProducts } from "./issue_work_products.js";
import { issues } from "./issues.js";

export const heartbeatRunArtifacts = pgTable(
  "heartbeat_run_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    runId: uuid("run_id").notNull().references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    artifactKind: text("artifact_kind").notNull(),
    role: text("role"),
    label: text("label"),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    issueWorkProductId: uuid("issue_work_product_id").references(() => issueWorkProducts.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyRunIdx: index("heartbeat_run_artifacts_company_run_idx").on(table.companyId, table.runId),
    runKindIdx: index("heartbeat_run_artifacts_run_kind_idx").on(table.runId, table.artifactKind),
    issueIdx: index("heartbeat_run_artifacts_issue_idx").on(table.issueId),
  }),
);

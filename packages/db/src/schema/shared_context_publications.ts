import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const sharedContextPublications = pgTable(
  "shared_context_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    sourceAgentId: uuid("source_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    summary: text("summary"),
    body: text("body").notNull(),
    tags: jsonb("tags").$type<string[]>(),
    visibility: text("visibility").notNull().default("project"),
    audienceAgentIds: jsonb("audience_agent_ids").$type<string[]>(),
    status: text("status").notNull().default("published"),
    freshness: text("freshness").notNull().default("recent"),
    freshnessAt: timestamp("freshness_at", { withTimezone: true }).notNull().defaultNow(),
    confidence: integer("confidence"),
    rank: integer("rank").notNull().default(100),
    provenance: jsonb("provenance").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusVisibilityIdx: index("shared_context_publications_company_status_visibility_idx").on(
      table.companyId,
      table.status,
      table.visibility,
    ),
    companyProjectStatusIdx: index("shared_context_publications_company_project_status_idx").on(
      table.companyId,
      table.projectId,
      table.status,
    ),
    companyIssueStatusIdx: index("shared_context_publications_company_issue_status_idx").on(
      table.companyId,
      table.issueId,
      table.status,
    ),
    companyFreshnessIdx: index("shared_context_publications_company_freshness_idx").on(
      table.companyId,
      table.freshnessAt,
    ),
  }),
);

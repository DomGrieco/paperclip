import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const managedSkills = pgTable(
  "managed_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    bodyMarkdown: text("body_markdown").notNull(),
    status: text("status").notNull().default("active"),
    importedFromAgentId: uuid("imported_from_agent_id").references(() => agents.id, { onDelete: "set null" }),
    importedFromRunId: uuid("imported_from_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    importedSourcePath: text("imported_source_path"),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("managed_skills_company_idx").on(table.companyId),
    companyStatusIdx: index("managed_skills_company_status_idx").on(table.companyId, table.status),
    companySlugIdx: index("managed_skills_company_slug_idx").on(table.companyId, table.slug),
    importedAgentIdx: index("managed_skills_imported_agent_idx").on(table.importedFromAgentId, table.importedAt),
    importedRunIdx: index("managed_skills_imported_run_idx").on(table.importedFromRunId),
    importedSourceIdx: index("managed_skills_imported_source_idx").on(table.companyId, table.importedSourcePath),
  }),
);

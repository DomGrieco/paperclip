import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { managedSkills } from "./managed_skills.js";
import { projects } from "./projects.js";

export const managedSkillScopes = pgTable(
  "managed_skill_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id").notNull().references(() => managedSkills.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skillIdx: index("managed_skill_scopes_skill_idx").on(table.skillId),
    companyScopeIdx: index("managed_skill_scopes_company_scope_idx").on(
      table.companyId,
      table.scopeType,
      table.enabled,
    ),
    projectIdx: index("managed_skill_scopes_project_idx").on(table.projectId, table.enabled),
    agentIdx: index("managed_skill_scopes_agent_idx").on(table.agentId, table.enabled),
    skillScopeUq: uniqueIndex("managed_skill_scopes_skill_scope_uq").on(
      table.skillId,
      table.scopeType,
      table.projectId,
      table.agentId,
    ),
  }),
);

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("managed_skills_company_idx").on(table.companyId),
    companyStatusIdx: index("managed_skills_company_status_idx").on(table.companyId, table.status),
    companySlugIdx: index("managed_skills_company_slug_idx").on(table.companyId, table.slug),
  }),
);

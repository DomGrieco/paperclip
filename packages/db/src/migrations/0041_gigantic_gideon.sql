CREATE TABLE "managed_skill_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid,
	"project_id" uuid,
	"agent_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"body_markdown" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_skill_scopes" ADD CONSTRAINT "managed_skill_scopes_skill_id_managed_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."managed_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_skill_scopes" ADD CONSTRAINT "managed_skill_scopes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_skill_scopes" ADD CONSTRAINT "managed_skill_scopes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_skill_scopes" ADD CONSTRAINT "managed_skill_scopes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_skills" ADD CONSTRAINT "managed_skills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_skill_scopes_skill_idx" ON "managed_skill_scopes" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "managed_skill_scopes_company_scope_idx" ON "managed_skill_scopes" USING btree ("company_id","scope_type","enabled");--> statement-breakpoint
CREATE INDEX "managed_skill_scopes_project_idx" ON "managed_skill_scopes" USING btree ("project_id","enabled");--> statement-breakpoint
CREATE INDEX "managed_skill_scopes_agent_idx" ON "managed_skill_scopes" USING btree ("agent_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "managed_skill_scopes_skill_scope_uq" ON "managed_skill_scopes" USING btree ("skill_id","scope_type","project_id","agent_id");--> statement-breakpoint
CREATE INDEX "managed_skills_company_idx" ON "managed_skills" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "managed_skills_company_status_idx" ON "managed_skills" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "managed_skills_company_slug_idx" ON "managed_skills" USING btree ("company_id","slug");
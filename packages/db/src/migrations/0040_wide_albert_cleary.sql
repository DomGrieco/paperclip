CREATE TABLE "shared_context_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid,
	"source_agent_id" uuid,
	"created_by_run_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"body" text NOT NULL,
	"tags" jsonb,
	"visibility" text DEFAULT 'project' NOT NULL,
	"audience_agent_ids" jsonb,
	"status" text DEFAULT 'published' NOT NULL,
	"freshness" text DEFAULT 'recent' NOT NULL,
	"freshness_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" integer,
	"rank" integer DEFAULT 100 NOT NULL,
	"provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_context_publications" ADD CONSTRAINT "shared_context_publications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_context_publications" ADD CONSTRAINT "shared_context_publications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_context_publications" ADD CONSTRAINT "shared_context_publications_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_context_publications" ADD CONSTRAINT "shared_context_publications_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_context_publications" ADD CONSTRAINT "shared_context_publications_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_context_publications_company_status_visibility_idx" ON "shared_context_publications" USING btree ("company_id","status","visibility");--> statement-breakpoint
CREATE INDEX "shared_context_publications_company_project_status_idx" ON "shared_context_publications" USING btree ("company_id","project_id","status");--> statement-breakpoint
CREATE INDEX "shared_context_publications_company_issue_status_idx" ON "shared_context_publications" USING btree ("company_id","issue_id","status");--> statement-breakpoint
CREATE INDEX "shared_context_publications_company_freshness_idx" ON "shared_context_publications" USING btree ("company_id","freshness_at");
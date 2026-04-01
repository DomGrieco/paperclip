ALTER TABLE "managed_skills" ADD COLUMN "imported_from_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "managed_skills" ADD COLUMN "imported_from_run_id" uuid;--> statement-breakpoint
ALTER TABLE "managed_skills" ADD COLUMN "imported_source_path" text;--> statement-breakpoint
ALTER TABLE "managed_skills" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "managed_skills" ADD CONSTRAINT "managed_skills_imported_from_agent_id_agents_id_fk" FOREIGN KEY ("imported_from_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_skills" ADD CONSTRAINT "managed_skills_imported_from_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("imported_from_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_skills_imported_agent_idx" ON "managed_skills" USING btree ("imported_from_agent_id","imported_at");--> statement-breakpoint
CREATE INDEX "managed_skills_imported_run_idx" ON "managed_skills" USING btree ("imported_from_run_id");--> statement-breakpoint
CREATE INDEX "managed_skills_imported_source_idx" ON "managed_skills" USING btree ("company_id","imported_source_path");

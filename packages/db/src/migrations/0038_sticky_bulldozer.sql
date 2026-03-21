CREATE TABLE "heartbeat_run_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"issue_id" uuid,
	"artifact_kind" text NOT NULL,
	"role" text,
	"label" text,
	"asset_id" uuid,
	"document_id" uuid,
	"issue_work_product_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD COLUMN "root_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD COLUMN "target_run_type" text;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD COLUMN "repair_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD COLUMN "requested_evidence_policy" text;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD COLUMN "verification_run_id" uuid;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "run_type" text DEFAULT 'worker' NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "root_run_id" uuid;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "graph_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "verification_verdict" text;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "repair_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "policy_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "artifact_bundle_json" jsonb;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "evidence_policy" text DEFAULT 'code_ci_evaluator_summary' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "evidence_policy_source" text DEFAULT 'company_default' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "review_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "last_verification_run_id" uuid;--> statement-breakpoint
ALTER TABLE "heartbeat_run_artifacts" ADD CONSTRAINT "heartbeat_run_artifacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_artifacts" ADD CONSTRAINT "heartbeat_run_artifacts_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_artifacts" ADD CONSTRAINT "heartbeat_run_artifacts_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_artifacts" ADD CONSTRAINT "heartbeat_run_artifacts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_artifacts" ADD CONSTRAINT "heartbeat_run_artifacts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_artifacts" ADD CONSTRAINT "heartbeat_run_artifacts_issue_work_product_id_issue_work_products_id_fk" FOREIGN KEY ("issue_work_product_id") REFERENCES "public"."issue_work_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "heartbeat_run_artifacts_company_run_idx" ON "heartbeat_run_artifacts" USING btree ("company_id","run_id");--> statement-breakpoint
CREATE INDEX "heartbeat_run_artifacts_run_kind_idx" ON "heartbeat_run_artifacts" USING btree ("run_id","artifact_kind");--> statement-breakpoint
CREATE INDEX "heartbeat_run_artifacts_issue_idx" ON "heartbeat_run_artifacts" USING btree ("issue_id");--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_root_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("root_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_parent_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_verification_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("verification_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_root_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("root_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_parent_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_last_verification_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("last_verification_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_wakeup_requests_root_run_idx" ON "agent_wakeup_requests" USING btree ("root_run_id");--> statement-breakpoint
CREATE INDEX "heartbeat_runs_root_run_idx" ON "heartbeat_runs" USING btree ("root_run_id");--> statement-breakpoint
CREATE INDEX "heartbeat_runs_parent_run_idx" ON "heartbeat_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "issues_company_review_ready_idx" ON "issues" USING btree ("company_id","review_ready_at");
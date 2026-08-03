CREATE TABLE "knowledge_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"org_id" text,
	"content_type" text NOT NULL,
	"content_id" text NOT NULL,
	"text" text NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"vector" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"org_id" text,
	"dataset_id" text,
	"analysis_id" text,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"severity" text DEFAULT 'low' NOT NULL,
	"evidence" text,
	"impact" text,
	"financial_impact" text,
	"kpi_key" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_glossary" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"org_id" text,
	"dataset_id" text,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_kpis" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"org_id" text,
	"dataset_id" text,
	"name" text NOT NULL,
	"metric_key" text NOT NULL,
	"value_text" text NOT NULL,
	"value_number" real,
	"unit" text,
	"period_key" text,
	"display_label" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"org_id" text,
	"file_name" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"file_sha256" text NOT NULL,
	"file_type" text,
	"chunk_size" integer NOT NULL,
	"total_chunks" integer NOT NULL,
	"received_chunks" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	"completed_at" integer
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "compressed_size_bytes" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "column_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "processing_status" text DEFAULT 'stored' NOT NULL;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "analysis_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "last_accessed_at" integer;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "raw_deleted_at" integer;--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_findings" ADD CONSTRAINT "knowledge_findings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_findings" ADD CONSTRAINT "knowledge_findings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_findings" ADD CONSTRAINT "knowledge_findings_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_findings" ADD CONSTRAINT "knowledge_findings_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_glossary" ADD CONSTRAINT "knowledge_glossary_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_glossary" ADD CONSTRAINT "knowledge_glossary_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_glossary" ADD CONSTRAINT "knowledge_glossary_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_kpis" ADD CONSTRAINT "knowledge_kpis_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_kpis" ADD CONSTRAINT "knowledge_kpis_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_kpis" ADD CONSTRAINT "knowledge_kpis_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddings_owner_idx" ON "knowledge_embeddings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "embeddings_org_idx" ON "knowledge_embeddings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "embeddings_content_idx" ON "knowledge_embeddings" USING btree ("content_type","content_id");--> statement-breakpoint
CREATE INDEX "findings_owner_idx" ON "knowledge_findings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "findings_org_idx" ON "knowledge_findings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "findings_analysis_idx" ON "knowledge_findings" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "glossary_owner_idx" ON "knowledge_glossary" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "glossary_org_idx" ON "knowledge_glossary" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "kpis_owner_idx" ON "knowledge_kpis" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "kpis_org_idx" ON "knowledge_kpis" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "kpis_period_idx" ON "knowledge_kpis" USING btree ("period_key");--> statement-breakpoint
CREATE INDEX "uploads_owner_idx" ON "uploads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "prefs_user_idx" ON "user_preferences" USING btree ("user_id");
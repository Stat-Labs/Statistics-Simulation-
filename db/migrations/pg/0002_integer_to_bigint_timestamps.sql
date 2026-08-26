-- Alter all timestamp columns from integer to bigint.
-- Date.now() returns milliseconds (~1.78 trillion in 2026) which overflows
-- Postgres integer (max ~2.1 billion). bigint supports up to ~9.2e18.

-- users
ALTER TABLE "users" ALTER COLUMN "email_verified_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "last_login_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" TYPE bigint;--> statement-breakpoint

-- organizations
ALTER TABLE "organizations" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "updated_at" TYPE bigint;--> statement-breakpoint

-- organization_members
ALTER TABLE "organization_members" ALTER COLUMN "invited_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "joined_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint

-- projects
ALTER TABLE "projects" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "updated_at" TYPE bigint;--> statement-breakpoint

-- datasets
ALTER TABLE "datasets" ALTER COLUMN "last_accessed_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "datasets" ALTER COLUMN "raw_deleted_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "datasets" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint

-- analyses
ALTER TABLE "analyses" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint

-- sessions
ALTER TABLE "sessions" ALTER COLUMN "expires_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "last_seen_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "revoked_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint

-- user_ai_keys
ALTER TABLE "user_ai_keys" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "user_ai_keys" ALTER COLUMN "updated_at" TYPE bigint;--> statement-breakpoint

-- org_ai_keys
ALTER TABLE "org_ai_keys" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "org_ai_keys" ALTER COLUMN "updated_at" TYPE bigint;--> statement-breakpoint

-- audit_logs
ALTER TABLE "audit_logs" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint

-- uploads
ALTER TABLE "uploads" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "updated_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "completed_at" TYPE bigint;--> statement-breakpoint

-- knowledge_findings
ALTER TABLE "knowledge_findings" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint

-- knowledge_glossary
ALTER TABLE "knowledge_glossary" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint
ALTER TABLE "knowledge_glossary" ALTER COLUMN "updated_at" TYPE bigint;--> statement-breakpoint

-- knowledge_kpis
ALTER TABLE "knowledge_kpis" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint

-- knowledge_embeddings
ALTER TABLE "knowledge_embeddings" ALTER COLUMN "created_at" TYPE bigint;--> statement-breakpoint

-- user_preferences
ALTER TABLE "user_preferences" ALTER COLUMN "updated_at" TYPE bigint;

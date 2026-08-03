CREATE TABLE `knowledge_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`org_id` text,
	`content_type` text NOT NULL,
	`content_id` text NOT NULL,
	`text` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `embeddings_owner_idx` ON `knowledge_embeddings` (`owner_id`);--> statement-breakpoint
CREATE INDEX `embeddings_org_idx` ON `knowledge_embeddings` (`org_id`);--> statement-breakpoint
CREATE INDEX `embeddings_content_idx` ON `knowledge_embeddings` (`content_type`,`content_id`);--> statement-breakpoint
CREATE TABLE `knowledge_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`org_id` text,
	`dataset_id` text,
	`analysis_id` text,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`severity` text DEFAULT 'low' NOT NULL,
	`evidence` text,
	`impact` text,
	`financial_impact` text,
	`kpi_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `findings_owner_idx` ON `knowledge_findings` (`owner_id`);--> statement-breakpoint
CREATE INDEX `findings_org_idx` ON `knowledge_findings` (`org_id`);--> statement-breakpoint
CREATE INDEX `findings_analysis_idx` ON `knowledge_findings` (`analysis_id`);--> statement-breakpoint
CREATE TABLE `knowledge_glossary` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`org_id` text,
	`dataset_id` text,
	`term` text NOT NULL,
	`definition` text NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`source` text DEFAULT 'auto' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `glossary_owner_idx` ON `knowledge_glossary` (`owner_id`);--> statement-breakpoint
CREATE INDEX `glossary_org_idx` ON `knowledge_glossary` (`org_id`);--> statement-breakpoint
CREATE TABLE `knowledge_kpis` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`org_id` text,
	`dataset_id` text,
	`name` text NOT NULL,
	`metric_key` text NOT NULL,
	`value_text` text NOT NULL,
	`value_number` real,
	`unit` text,
	`period_key` text,
	`display_label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kpis_owner_idx` ON `knowledge_kpis` (`owner_id`);--> statement-breakpoint
CREATE INDEX `kpis_org_idx` ON `knowledge_kpis` (`org_id`);--> statement-breakpoint
CREATE INDEX `kpis_period_idx` ON `knowledge_kpis` (`period_key`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`org_id` text,
	`file_name` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`file_sha256` text NOT NULL,
	`file_type` text,
	`chunk_size` integer NOT NULL,
	`total_chunks` integer NOT NULL,
	`received_chunks` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `uploads_owner_idx` ON `uploads` (`owner_id`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`org_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prefs_user_idx` ON `user_preferences` (`user_id`);--> statement-breakpoint
ALTER TABLE `datasets` ADD `compressed_size_bytes` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `datasets` ADD `column_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `datasets` ADD `processing_status` text DEFAULT 'stored' NOT NULL;--> statement-breakpoint
ALTER TABLE `datasets` ADD `analysis_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `datasets` ADD `last_accessed_at` integer;--> statement-breakpoint
ALTER TABLE `datasets` ADD `raw_deleted_at` integer;
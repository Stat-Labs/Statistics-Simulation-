CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`dataset_id` text,
	`owner_id` text NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'saved' NOT NULL,
	`storage_provider` text DEFAULT 'cloudinary' NOT NULL,
	`storage_key` text NOT NULL,
	`storage_url` text NOT NULL,
	`schema_json` text,
	`summary` text,
	`provider_used` text,
	`model_type` text,
	`row_count` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `analyses_owner_idx` ON `analyses` (`owner_id`);--> statement-breakpoint
CREATE INDEX `analyses_project_idx` ON `analyses` (`project_id`);--> statement-breakpoint
CREATE INDEX `analyses_dataset_idx` ON `analyses` (`dataset_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`user_id` text,
	`action` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`meta` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_org_idx` ON `audit_logs` (`org_id`);--> statement-breakpoint
CREATE TABLE `datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`mime_type` text,
	`storage_provider` text DEFAULT 'cloudinary' NOT NULL,
	`storage_key` text NOT NULL,
	`storage_url` text NOT NULL,
	`row_count` integer DEFAULT 0,
	`schema_json` text,
	`sha256` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `datasets_owner_idx` ON `datasets` (`owner_id`);--> statement-breakpoint
CREATE INDEX `datasets_project_idx` ON `datasets` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `datasets_owner_sha_idx` ON `datasets` (`owner_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `org_ai_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`provider` text NOT NULL,
	`key_encrypted` text NOT NULL,
	`key_hint` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_ai_keys_org_provider_idx` ON `org_ai_keys` (`org_id`,`provider`);--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_email` text,
	`invite_token` text,
	`invited_at` integer,
	`joined_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_members_org_user_idx` ON `organization_members` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `org_members_user_idx` ON `organization_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_slug_idx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE INDEX `projects_org_idx` ON `projects` (`org_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_ai_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`key_encrypted` text NOT NULL,
	`key_hint` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_ai_keys_user_provider_idx` ON `user_ai_keys` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`avatar_url` text,
	`account_type` text DEFAULT 'personal' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`email_verified_at` integer,
	`preferred_ai_provider` text DEFAULT 'groq' NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);
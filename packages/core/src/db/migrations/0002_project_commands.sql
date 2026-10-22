ALTER TABLE "projects" ADD COLUMN "test_command" text DEFAULT 'pnpm test' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "app_command" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "app_health_path" text DEFAULT '/' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "holdouts_command" text;
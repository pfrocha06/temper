CREATE TABLE "agents" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"adapter" text NOT NULL,
	"model" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb NOT NULL,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"runs_per_hour" integer DEFAULT 6 NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"options" jsonb DEFAULT '["approve","reject"]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolution" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"dispatch_id" text,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dispatch_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"stage" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version" integer NOT NULL,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"verdict" text,
	"summary" text,
	"session_id" text,
	"temperature_snapshot_id" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"repo_path" text NOT NULL,
	"remote_url" text,
	"holdouts_path" text,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temperature_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"value" double precision NOT NULL,
	"regime" text NOT NULL,
	"contributions" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"spec" text DEFAULT '' NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_id" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"stage" text,
	"branch" text,
	"worktree_path" text,
	"pr_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_events" ADD CONSTRAINT "dispatch_events_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "artifacts_ticket_idx" ON "artifacts" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "audit_events_kind_idx" ON "audit_events" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "dispatch_events_dispatch_idx" ON "dispatch_events" USING btree ("dispatch_id","id");--> statement-breakpoint
CREATE INDEX "dispatches_ticket_idx" ON "dispatches" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "dispatches_status_idx" ON "dispatches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");
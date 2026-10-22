CREATE TABLE "chat_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"author" text NOT NULL,
	"content" text NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"title" text NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "mcp_servers" jsonb DEFAULT '["temper"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_chat_idx" ON "chat_messages" USING btree ("chat_id","id");
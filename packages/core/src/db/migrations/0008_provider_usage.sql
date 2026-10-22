CREATE TABLE "provider_limits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"adapter" text NOT NULL,
	"limit_type" text NOT NULL,
	"status" text NOT NULL,
	"resets_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_settings" (
	"adapter" text PRIMARY KEY NOT NULL,
	"caps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"adapter" text NOT NULL,
	"model" text NOT NULL,
	"dispatch_id" text,
	"chat_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"api_ms" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_limits_adapter_idx" ON "provider_limits" USING btree ("adapter","limit_type","at");--> statement-breakpoint
CREATE INDEX "provider_usage_adapter_idx" ON "provider_usage" USING btree ("adapter","at");
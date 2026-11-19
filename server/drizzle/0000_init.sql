CREATE TABLE "mission_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mission_id" text NOT NULL,
	"completions" integer DEFAULT 0 NOT NULL,
	"best_time" real,
	"last_completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "player_characters" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"appearance" jsonb NOT NULL,
	"last_pos" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"kind" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inv_qty_nonneg" CHECK ("player_inventory"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "player_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"avatar" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"playtime_sec" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"property_id" text NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"model" text NOT NULL,
	"color" integer NOT NULL,
	"mods" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health" integer DEFAULT 1000 NOT NULL,
	"stored" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_nonneg" CHECK ("player_wallets"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "room_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"name" text NOT NULL,
	"host_user_id" uuid,
	"mode" text NOT NULL,
	"max_players" integer NOT NULL,
	"peak_players" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"username_lower" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"ref" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_characters" ADD CONSTRAINT "player_characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_inventory" ADD CONSTRAINT "player_inventory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_properties" ADD CONSTRAINT "player_properties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_settings" ADD CONSTRAINT "player_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_vehicles" ADD CONSTRAINT "player_vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallets" ADD CONSTRAINT "player_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mp_user_mission_idx" ON "mission_progress" USING btree ("user_id","mission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_user_item_idx" ON "player_inventory" USING btree ("user_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prop_user_prop_idx" ON "player_properties" USING btree ("user_id","property_id");--> statement-breakpoint
CREATE INDEX "veh_user_idx" ON "player_vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_idx" ON "users" USING btree ("username_lower");--> statement-breakpoint
CREATE UNIQUE INDEX "wtx_idem_idx" ON "wallet_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "wtx_user_idx" ON "wallet_transactions" USING btree ("user_id");
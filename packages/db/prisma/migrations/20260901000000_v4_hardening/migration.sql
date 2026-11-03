-- v4 hardening (audit v4): erasure/lifecycle, manual-JD provenance, FTS indexes, auth tokens, per-user alerts.

-- GH-8: cover notes are suggestions like everything else the model writes
ALTER TYPE "SuggestionKind" ADD VALUE IF NOT EXISTS 'cover_letter';

-- NEW-03: user-pasted descriptions live beside (never over) the crawled one
ALTER TABLE "jobs" ADD COLUMN "description_manual" TEXT;
ALTER TABLE "jobs" ADD COLUMN "description_manual_by" TEXT;
ALTER TABLE "jobs" ADD COLUMN "description_manual_at" TIMESTAMP(3);
-- Backfill: rows whose requirements say the description was pasted by hand were overwritten in place (v3);
-- keep the text as the manual copy so nothing is lost, and leave `description` for the crawler to refresh.
UPDATE "jobs" j SET "description_manual" = j."description", "description_manual_at" = r."updated_at"
  FROM "job_requirements" r WHERE r."job_id" = j."id" AND r."description_source" = 'manual' AND j."description_manual" IS NULL;

-- NEW-09: full-text + trigram search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE "jobs" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("company", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("skills", '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce("description", ''), 20000)), 'C')
  ) STORED;
CREATE INDEX "jobs_search_tsv_idx" ON "jobs" USING GIN ("search_tsv");
CREATE INDEX "jobs_title_idx" ON "jobs" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "jobs_company_idx" ON "jobs" USING GIN ("company" gin_trgm_ops);

-- NEW-08: the in-process vector index pages on updated_at (upserts keep created_at)
ALTER TABLE "embeddings" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "embeddings_owner_type_updated_at_idx" ON "embeddings"("owner_type", "updated_at");

-- NEW-07: account lifecycle
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "password_hash" IS NOT NULL OR "role" = 'admin';
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX "auth_tokens_user_id_kind_idx" ON "auth_tokens"("user_id", "kind");
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NEW-03 / GH-6: per-user alert channels
CREATE TABLE "alert_channels" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "classes" TEXT[] DEFAULT ARRAY['p1_global_remote', 'p2_india_remote']::TEXT[],
    "min_score" INTEGER NOT NULL DEFAULT 0,
    "instant" BOOLEAN NOT NULL DEFAULT true,
    "digest" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "alert_channels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "alert_channels_user_id_kind_address_key" ON "alert_channels"("user_id", "kind", "address");
CREATE INDEX "alert_channels_enabled_idx" ON "alert_channels"("enabled");
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- per-recipient notification dedupe
CREATE INDEX "notifications_canonical_hash_channel_recipient_idx" ON "notifications"("canonical_hash", "channel", "recipient");

-- NEW-01: one-off cleanup of vectors already orphaned by v3 deletions
DELETE FROM "embeddings" e WHERE e."owner_type" = 'resume_version' AND NOT EXISTS (SELECT 1 FROM "resume_versions" v WHERE v."id" = e."owner_id");
DELETE FROM "embeddings" e WHERE e."owner_type" = 'profile' AND NOT EXISTS (SELECT 1 FROM "candidate_profiles" p WHERE p."user_id" = e."owner_id");
DELETE FROM "embeddings" e WHERE e."owner_type" IN ('job', 'requirement') AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = e."owner_id");

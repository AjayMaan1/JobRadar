-- v5: dynamic user preferences (docs/HLD-dynamic-preferences.md)

ALTER TABLE "jobs" ADD COLUMN "salary_usd_min" DOUBLE PRECISION;
ALTER TABLE "jobs" ADD COLUMN "salary_usd_max" DOUBLE PRECISION;
-- backfill the USD pivot from the INR normalisation used so far (static rate; re-extraction refreshes it)
UPDATE "jobs" SET "salary_usd_min" = ROUND("salary_inr_min" / 84.5), "salary_usd_max" = ROUND("salary_inr_max" / 84.5) WHERE "salary_inr_min" IS NOT NULL;

CREATE TABLE "job_facts" (
    "job_id" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_facts_pkey" PRIMARY KEY ("job_id")
);
ALTER TABLE "job_facts" ADD CONSTRAINT "job_facts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_preferences" (
    "user_id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'preset',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "preference_presets" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "doc" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "preference_presets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "preference_presets_owner_user_id_name_key" ON "preference_presets"("owner_user_id", "name");
ALTER TABLE "preference_presets" ADD CONSTRAINT "preference_presets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "preference_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "doc" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "preference_history_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "preference_history_user_id_version_key" ON "preference_history"("user_id", "version");
ALTER TABLE "preference_history" ADD CONSTRAINT "preference_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "job_user_evals" (
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "components" JSONB NOT NULL,
    "prefs_version" INTEGER NOT NULL,
    "evaluator_version" TEXT NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_user_evals_pkey" PRIMARY KEY ("user_id","job_id")
);
CREATE INDEX "job_user_evals_user_id_tier_evaluated_at_idx" ON "job_user_evals"("user_id", "tier", "evaluated_at" DESC);
CREATE INDEX "job_user_evals_user_id_score_idx" ON "job_user_evals"("user_id", "score" DESC);
CREATE INDEX "job_user_evals_job_id_idx" ON "job_user_evals"("job_id");
ALTER TABLE "job_user_evals" ADD CONSTRAINT "job_user_evals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_user_evals" ADD CONSTRAINT "job_user_evals_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

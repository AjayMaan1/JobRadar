-- v3b: sessions/auth (C1), per-user job state (C2), apply-url identity (C0-5), suggestions (C7), apply kit (C10), render fields (C9)

-- CreateEnum
CREATE TYPE "SuggestionKind" AS ENUM ('keyword_confirm', 'bullet_rewrite', 'reorder', 'skills_section', 'formatting', 'headline', 'about', 'answer');
CREATE TYPE "SuggestionStatus" AS ENUM ('pending', 'accepted', 'rejected', 'edited', 'answered');

-- users: auth fields
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMP(3);

-- sessions
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- jobs: normalised apply url (C0-5). Full normalisation (tracking params) happens in code; SQL backfill is lower/trim.
ALTER TABLE "jobs" ADD COLUMN "apply_url_normalized" TEXT;
UPDATE "jobs" SET "apply_url_normalized" = lower(regexp_replace(regexp_replace("apply_url", '[#].*$', ''), '/+$', '')) WHERE "apply_url" IS NOT NULL;
CREATE INDEX "jobs_apply_url_normalized_idx" ON "jobs"("apply_url_normalized");

-- candidate_profiles: apply defaults
ALTER TABLE "candidate_profiles" ADD COLUMN "apply_defaults" JSONB NOT NULL DEFAULT '{}';

-- resume_versions: render verification
ALTER TABLE "resume_versions" ADD COLUMN "render_error" TEXT;
ALTER TABLE "resume_versions" ADD COLUMN "render_warnings" JSONB;
ALTER TABLE "resume_versions" ADD COLUMN "rendered_at" TIMESTAMP(3);

-- job_user_states (C2)
CREATE TABLE "job_user_states" (
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "match_score" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_user_states_pkey" PRIMARY KEY ("user_id","job_id")
);
CREATE INDEX "job_user_states_user_id_state_idx" ON "job_user_states"("user_id", "state");
ALTER TABLE "job_user_states" ADD CONSTRAINT "job_user_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_user_states" ADD CONSTRAINT "job_user_states_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- applications: user + apply-kit artifacts (C10)
ALTER TABLE "applications" ADD COLUMN "user_id" TEXT;
ALTER TABLE "applications" ADD COLUMN "resume_version_id" TEXT;
ALTER TABLE "applications" ADD COLUMN "headline_used" TEXT;
ALTER TABLE "applications" ADD COLUMN "about_used" TEXT;
ALTER TABLE "applications" ADD COLUMN "cover_note" TEXT;
ALTER TABLE "applications" ADD COLUMN "answers" JSONB;
ALTER TABLE "applications" ADD COLUMN "submitted_via" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "applications" ADD COLUMN "events" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS "applications_job_id_fkey";
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_version_id_fkey" FOREIGN KEY ("resume_version_id") REFERENCES "resume_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill v2 single-user state into the first (owner) user, if one exists. jobs.status becomes lifecycle-only.
DO $$
DECLARE owner TEXT;
BEGIN
  SELECT id INTO owner FROM "users" ORDER BY "created_at" ASC LIMIT 1;
  IF owner IS NOT NULL THEN
    INSERT INTO "job_user_states" ("user_id", "job_id", "state")
      SELECT owner, id, status FROM "jobs" WHERE status IN ('saved', 'applied', 'rejected')
      ON CONFLICT DO NOTHING;
    UPDATE "applications" SET "user_id" = owner WHERE "user_id" IS NULL;
    -- pre-v3 duplicates per job: keep the most recent, drop the rest so the unique index can be created
    DELETE FROM "applications" a USING "applications" b
      WHERE a."user_id" = b."user_id" AND a."job_id" = b."job_id" AND a."id" <> b."id"
        AND (COALESCE(a."applied_at", 'epoch'::timestamp) < COALESCE(b."applied_at", 'epoch'::timestamp)
             OR (COALESCE(a."applied_at", 'epoch'::timestamp) = COALESCE(b."applied_at", 'epoch'::timestamp) AND a."id" < b."id"));
  END IF;
  UPDATE "jobs" SET status = 'new' WHERE status IN ('saved', 'applied', 'rejected');
END $$;
CREATE UNIQUE INDEX "applications_user_id_job_id_key" ON "applications"("user_id", "job_id");

-- suggestions (C7/C8/C10)
CREATE TABLE "suggestions" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "kind" "SuggestionKind" NOT NULL,
    "target_path" TEXT,
    "before" TEXT,
    "after" TEXT,
    "rationale" TEXT NOT NULL,
    "jd_evidence" TEXT,
    "skill" TEXT,
    "grounding" JSONB,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "expected_gain" INTEGER,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'pending',
    "user_edit" TEXT,
    "answer" JSONB,
    "variant" TEXT,
    "question" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "suggestions_report_id_status_idx" ON "suggestions"("report_id", "status");
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "ats_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

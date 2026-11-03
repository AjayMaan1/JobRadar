-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_type" TEXT,
    "source_url" TEXT,
    "apply_url" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "remote_type" TEXT NOT NULL DEFAULT 'unknown',
    "eligibility" TEXT NOT NULL DEFAULT 'unknown',
    "eligibility_confidence" DOUBLE PRECISION,
    "eligibility_evidence" TEXT,
    "salary_min" DOUBLE PRECISION,
    "salary_max" DOUBLE PRECISION,
    "salary_currency" TEXT,
    "salary_period" TEXT,
    "salary_confidence" DOUBLE PRECISION,
    "salary_inr_min" DOUBLE PRECISION,
    "salary_inr_max" DOUBLE PRECISION,
    "experience_min" DOUBLE PRECISION,
    "experience_max" DOUBLE PRECISION,
    "seniority" TEXT,
    "category" TEXT,
    "skills" TEXT NOT NULL,
    "description" TEXT,
    "posted_at" TIMESTAMP(3),
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "source_fingerprint" TEXT,
    "canonical_hash" TEXT NOT NULL,
    "ranking_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "source_type" TEXT,
    "region" TEXT,
    "country" TEXT,
    "ingestion_method" TEXT NOT NULL,
    "api_url" TEXT,
    "careers_url" TEXT,
    "ats_type" TEXT,
    "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "refresh_interval_hours" INTEGER NOT NULL DEFAULT 8,
    "last_crawled_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiters" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "agency" TEXT,
    "country" TEXT,
    "region" TEXT,
    "specialization" TEXT,
    "linkedin_url" TEXT,
    "website_url" TEXT,
    "email" TEXT,
    "source_url" TEXT,
    "confidence" DOUBLE PRECISION,
    "notes" TEXT,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "recruiters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "applied_at" TIMESTAMP(3),
    "follow_up_at" TIMESTAMP(3),
    "resume_version" TEXT,
    "cover_letter_version" TEXT,
    "notes" TEXT,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "job_id" TEXT,
    "channel" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "recipient" TEXT,
    "score" DOUBLE PRECISION,
    "payload" TEXT,
    "sent_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "canonical_hash" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_canonical_hash_key" ON "jobs"("canonical_hash");

-- CreateIndex
CREATE INDEX "jobs_canonical_hash_idx" ON "jobs"("canonical_hash");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_ranking_score_idx" ON "jobs"("ranking_score");

-- CreateIndex
CREATE INDEX "jobs_posted_at_idx" ON "jobs"("posted_at");

-- CreateIndex
CREATE INDEX "jobs_discovered_at_idx" ON "jobs"("discovered_at");

-- CreateIndex
CREATE UNIQUE INDEX "sources_domain_key" ON "sources"("domain");

-- CreateIndex
CREATE INDEX "sources_enabled_idx" ON "sources"("enabled");

-- CreateIndex
CREATE INDEX "applications_job_id_idx" ON "applications"("job_id");

-- CreateIndex
CREATE INDEX "notifications_canonical_hash_channel_notification_type_idx" ON "notifications"("canonical_hash", "channel", "notification_type");

-- CreateIndex
CREATE INDEX "notifications_sent_at_idx" ON "notifications"("sent_at");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


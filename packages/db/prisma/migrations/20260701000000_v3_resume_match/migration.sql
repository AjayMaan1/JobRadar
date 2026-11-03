-- v3: users, candidate profiles, resumes, immutable resume versions, job requirements, match reports
-- Design: audit/HLD-apply-portal-v3.md

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateTable
CREATE TABLE "candidate_profiles" (
    "user_id" TEXT NOT NULL,
    "headline" TEXT,
    "about" TEXT,
    "target_titles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" JSONB NOT NULL DEFAULT '[]',
    "years_experience" DOUBLE PRECISION,
    "pay_floor_inr" DOUBLE PRECISION,
    "confirmed_facts" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "resumes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_master" BOOLEAN NOT NULL DEFAULT false,
    "source_file_key" TEXT,
    "source_mime" TEXT,
    "source_filename" TEXT,
    "parse_status" TEXT NOT NULL DEFAULT 'pending',
    "parse_error" TEXT,
    "parse_warnings" JSONB NOT NULL DEFAULT '[]',
    "raw_text" TEXT,
    "current_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "resumes_user_id_idx" ON "resumes"("user_id");
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "resume_versions" (
    "id" TEXT NOT NULL,
    "resume_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "job_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'master',
    "content" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'ats-classic',
    "pdf_key" TEXT,
    "docx_key" TEXT,
    "render_status" TEXT NOT NULL DEFAULT 'none',
    "tailored_headline" BOOLEAN NOT NULL DEFAULT false,
    "tailored_about" BOOLEAN NOT NULL DEFAULT false,
    "change_log" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resume_versions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "resume_versions_resume_id_created_at_idx" ON "resume_versions"("resume_id", "created_at");
CREATE INDEX "resume_versions_job_id_idx" ON "resume_versions"("job_id");
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "resume_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "job_requirements" (
    "job_id" TEXT NOT NULL,
    "description_hash" TEXT NOT NULL,
    "extractor_version" TEXT NOT NULL,
    "description_source" TEXT NOT NULL DEFAULT 'crawl',
    "title_normalized" TEXT,
    "seniority" TEXT,
    "years_min" DOUBLE PRECISION,
    "required" JSONB NOT NULL DEFAULT '[]',
    "preferred" JSONB NOT NULL DEFAULT '[]',
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "application_questions" JSONB,
    "llm_used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_requirements_pkey" PRIMARY KEY ("job_id")
);
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ats_reports" (
    "id" TEXT NOT NULL,
    "resume_version_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "scorer_version" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ats_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ats_reports_resume_version_id_job_id_scorer_version_key" ON "ats_reports"("resume_version_id", "job_id", "scorer_version");
CREATE INDEX "ats_reports_job_id_idx" ON "ats_reports"("job_id");
ALTER TABLE "ats_reports" ADD CONSTRAINT "ats_reports_resume_version_id_fkey" FOREIGN KEY ("resume_version_id") REFERENCES "resume_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ats_reports" ADD CONSTRAINT "ats_reports_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

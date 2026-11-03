-- v2: watchlist / discovery engine

-- Enums
CREATE TYPE "AtsType" AS ENUM ('greenhouse','lever','ashby','workable','smartrecruiters','recruitee','teamtailor','personio','bamboohr','rippling','workday','custom_json','rss','html');
CREATE TYPE "AtsCostClass" AS ENUM ('cheap','medium','expensive');
CREATE TYPE "CompanyStatus" AS ENUM ('discovered','resolving','unresolved','probing','watched','dormant','retired','blocked');
CREATE TYPE "PollTier" AS ENUM ('hot','warm','cold','dormant');
CREATE TYPE "BoardStatus" AS ENUM ('active','failing','blocked','gone','disabled');
CREATE TYPE "DiscoverySource" AS ENUM ('aggregator_apply_url','hn_who_is_hiring','github_list','yc_directory','himalayas_companies','common_crawl','funding_feed','leetcode_comp','reddit','lca_dataset','manual');
CREATE TYPE "ResolutionStatus" AS ENUM ('pending','resolved','no_ats','rejected');
CREATE TYPE "PayEvidenceSource" AS ENUM ('own_posting','hn_post','leetcode_comp','lca_dataset','levels_manual','manual');
CREATE TYPE "PayBandStatus" AS ENUM ('unknown','above_floor','below_floor');
CREATE TYPE "FetchOutcome" AS ENUM ('unchanged','changed','error','rate_limited','blocked','timeout');
CREATE TYPE "CircuitState" AS ENUM ('closed','open','half_open');
CREATE TYPE "OpportunityClass" AS ENUM ('p1_global_remote','p2_india_remote','p3_ncr_hybrid','none');
CREATE TYPE "EmploymentType" AS ENUM ('full_time','contract','part_time','internship','unknown');

-- jobs additions
ALTER TABLE "jobs"
  ADD COLUMN "base_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "company_id" TEXT,
  ADD COLUMN "employment_type" "EmploymentType" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "opportunity_class" "OpportunityClass" NOT NULL DEFAULT 'none',
  ADD COLUMN "class_reason" TEXT,
  ADD COLUMN "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "closed_at" TIMESTAMP(3),
  ADD COLUMN "liveness_checked_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "jobs" SET "first_seen_at" = "discovered_at", "last_seen_at" = "discovered_at";
CREATE INDEX "jobs_opportunity_class_status_first_seen_at_idx" ON "jobs"("opportunity_class","status","first_seen_at" DESC);
CREATE INDEX "jobs_company_id_idx" ON "jobs"("company_id");
CREATE INDEX "jobs_closed_at_idx" ON "jobs"("closed_at");

-- sources additions
ALTER TABLE "sources"
  ADD COLUMN "etag" TEXT,
  ADD COLUMN "last_modified" TEXT,
  ADD COLUMN "body_hash" TEXT,
  ADD COLUMN "backoff_until" TIMESTAMP(3),
  ADD COLUMN "availability_issue" TEXT;

-- companies
CREATE TABLE "companies" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "domain" TEXT,
  "hq_country" TEXT,
  "funding_stage" TEXT,
  "funding_last_at" TIMESTAMP(3),
  "employee_range" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "remote_policy" TEXT,
  "hires_in" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "eligibility_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "eligibility_evidence" JSONB,
  "eligibility_last_seen_at" TIMESTAMP(3),
  "engineering_share" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "posting_rate_30d" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "active_postings" INTEGER NOT NULL DEFAULT 0,
  "last_posting_at" TIMESTAMP(3),
  "pay_min_inr" DOUBLE PRECISION,
  "pay_max_inr" DOUBLE PRECISION,
  "pay_median_inr" DOUBLE PRECISION,
  "pay_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pay_evidence_count" INTEGER NOT NULL DEFAULT 0,
  "pay_last_at" TIMESTAMP(3),
  "pay_band_status" "PayBandStatus" NOT NULL DEFAULT 'unknown',
  "best_class" "OpportunityClass" NOT NULL DEFAULT 'none',
  "class_counts_180d" JSONB,
  "offices" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "anchor" BOOLEAN NOT NULL DEFAULT false,
  "status" "CompanyStatus" NOT NULL DEFAULT 'discovered',
  "status_reason" TEXT,
  "tier" "PollTier" NOT NULL DEFAULT 'cold',
  "tier_reason" TEXT,
  "tier_updated_at" TIMESTAMP(3),
  "manual_tier" "PollTier",
  "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "discovered_via" "DiscoverySource" NOT NULL,
  "first_qualified_at" TIMESTAMP(3),
  "last_probed_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "companies_domain_key" ON "companies"("domain");
CREATE INDEX "companies_normalized_name_idx" ON "companies"("normalized_name");
CREATE INDEX "companies_status_tier_idx" ON "companies"("status","tier");
CREATE INDEX "companies_pay_band_status_idx" ON "companies"("pay_band_status");
CREATE INDEX "companies_hires_in_idx" ON "companies" USING GIN ("hires_in");
CREATE INDEX "companies_anchor_idx" ON "companies"("anchor");
CREATE INDEX "companies_best_class_idx" ON "companies"("best_class");

-- company_boards
CREATE TABLE "company_boards" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "ats_type" "AtsType" NOT NULL,
  "slug" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "api_url" TEXT NOT NULL,
  "careers_url" TEXT,
  "cost_class" "AtsCostClass" NOT NULL,
  "query_scope" JSONB,
  "status" "BoardStatus" NOT NULL DEFAULT 'active',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "next_poll_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_poll_at" TIMESTAMP(3),
  "last_success_at" TIMESTAMP(3),
  "last_changed_at" TIMESTAMP(3),
  "backoff_until" TIMESTAMP(3),
  "etag" TEXT,
  "last_modified" TEXT,
  "body_hash" TEXT,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "consecutive_unchanged" INTEGER NOT NULL DEFAULT 0,
  "blocked_count_7d" INTEGER NOT NULL DEFAULT 0,
  "last_status_code" INTEGER,
  "last_error" TEXT,
  "last_posting_count" INTEGER NOT NULL DEFAULT 0,
  "suspect_drop_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_boards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "company_boards_ats_type_slug_key" ON "company_boards"("ats_type","slug");
CREATE INDEX "company_boards_enabled_status_next_poll_at_idx" ON "company_boards"("enabled","status","next_poll_at");
CREATE INDEX "company_boards_host_idx" ON "company_boards"("host");

-- company_discoveries
CREATE TABLE "company_discoveries" (
  "id" TEXT NOT NULL,
  "company_id" TEXT,
  "source" "DiscoverySource" NOT NULL,
  "external_ref" TEXT NOT NULL,
  "name_as_seen" TEXT,
  "domain_as_seen" TEXT,
  "careers_url_as_seen" TEXT,
  "ats_hint" "AtsType",
  "slug_hint" TEXT,
  "payload" JSONB,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seen_count" INTEGER NOT NULL DEFAULT 1,
  "resolution" "ResolutionStatus" NOT NULL DEFAULT 'pending',
  "resolved_at" TIMESTAMP(3),
  "resolution_note" TEXT,
  CONSTRAINT "company_discoveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "company_discoveries_source_external_ref_key" ON "company_discoveries"("source","external_ref");
CREATE INDEX "company_discoveries_resolution_first_seen_at_idx" ON "company_discoveries"("resolution","first_seen_at");
CREATE INDEX "company_discoveries_company_id_idx" ON "company_discoveries"("company_id");

-- pay_evidence
CREATE TABLE "pay_evidence" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "source" "PayEvidenceSource" NOT NULL,
  "job_id" TEXT,
  "role_title" TEXT,
  "level" TEXT,
  "location_text" TEXT,
  "country" TEXT,
  "min_amount" DOUBLE PRECISION,
  "max_amount" DOUBLE PRECISION,
  "currency" TEXT,
  "period" TEXT,
  "inr_annual_min" DOUBLE PRECISION,
  "inr_annual_max" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "url" TEXT,
  "raw_snippet" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pay_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pay_evidence_company_id_observed_at_idx" ON "pay_evidence"("company_id","observed_at");
CREATE INDEX "pay_evidence_source_idx" ON "pay_evidence"("source");

-- job_sightings
CREATE TABLE "job_sightings" (
  "id" TEXT NOT NULL,
  "feed_key" TEXT NOT NULL,
  "board_id" TEXT,
  "source_id" TEXT,
  "external_id" TEXT NOT NULL,
  "job_id" TEXT,
  "payload_hash" TEXT NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "missing_count" INTEGER NOT NULL DEFAULT 0,
  "gone_at" TIMESTAMP(3),
  "posted_at_src" TIMESTAMP(3),
  "detail_fetched_at" TIMESTAMP(3),
  CONSTRAINT "job_sightings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_sightings_feed_key_external_id_key" ON "job_sightings"("feed_key","external_id");
CREATE INDEX "job_sightings_job_id_idx" ON "job_sightings"("job_id");
CREATE INDEX "job_sightings_first_seen_at_idx" ON "job_sightings"("first_seen_at");
CREATE INDEX "job_sightings_board_id_gone_at_idx" ON "job_sightings"("board_id","gone_at");
CREATE INDEX "job_sightings_gone_at_idx" ON "job_sightings"("gone_at");

-- fetch_runs
CREATE TABLE "fetch_runs" (
  "id" TEXT NOT NULL,
  "board_id" TEXT,
  "source_id" TEXT,
  "host" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "duration_ms" INTEGER,
  "http_status" INTEGER,
  "bytes" INTEGER,
  "outcome" "FetchOutcome" NOT NULL,
  "new_count" INTEGER NOT NULL DEFAULT 0,
  "changed_count" INTEGER NOT NULL DEFAULT 0,
  "gone_count" INTEGER NOT NULL DEFAULT 0,
  "error_class" TEXT,
  "error_message" TEXT,
  CONSTRAINT "fetch_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fetch_runs_board_id_started_at_idx" ON "fetch_runs"("board_id","started_at");
CREATE INDEX "fetch_runs_host_started_at_idx" ON "fetch_runs"("host","started_at");
CREATE INDEX "fetch_runs_outcome_started_at_idx" ON "fetch_runs"("outcome","started_at");

-- host_policies
CREATE TABLE "host_policies" (
  "id" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "max_concurrency" INTEGER NOT NULL DEFAULT 2,
  "min_interval_ms" INTEGER NOT NULL DEFAULT 1000,
  "burst" INTEGER NOT NULL DEFAULT 3,
  "daily_budget" INTEGER NOT NULL DEFAULT 20000,
  "probe_budget_per_day" INTEGER NOT NULL DEFAULT 300,
  "respect_robots" BOOLEAN NOT NULL DEFAULT true,
  "circuit_state" "CircuitState" NOT NULL DEFAULT 'closed',
  "circuit_open_until" TIMESTAMP(3),
  "circuit_opened_at" TIMESTAMP(3),
  "trip_count_7d" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "host_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "host_policies_host_key" ON "host_policies"("host");

-- FKs
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "company_boards" ADD CONSTRAINT "company_boards_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_discoveries" ADD CONSTRAINT "company_discoveries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pay_evidence" ADD CONSTRAINT "pay_evidence_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pay_evidence" ADD CONSTRAINT "pay_evidence_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_sightings" ADD CONSTRAINT "job_sightings_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "company_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_sightings" ADD CONSTRAINT "job_sightings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_sightings" ADD CONSTRAINT "job_sightings_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fetch_runs" ADD CONSTRAINT "fetch_runs_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "company_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

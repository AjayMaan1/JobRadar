-- v3c: semantic layer (C13) — embeddings as bytea in plain Postgres; per-user semantic fit.

CREATE TABLE "embeddings" (
    "id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "chunk_key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "vector" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "embeddings_owner_type_owner_id_chunk_key_model_key" ON "embeddings"("owner_type", "owner_id", "chunk_key", "model");
CREATE INDEX "embeddings_owner_type_owner_id_idx" ON "embeddings"("owner_type", "owner_id");
CREATE INDEX "embeddings_owner_type_created_at_idx" ON "embeddings"("owner_type", "created_at");

CREATE TABLE "job_fits" (
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "fit_score" INTEGER NOT NULL,
    "keyword_score" INTEGER,
    "top_matches" JSONB,
    "model" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_fits_pkey" PRIMARY KEY ("user_id","job_id")
);
CREATE INDEX "job_fits_user_id_fit_score_idx" ON "job_fits"("user_id", "fit_score" DESC);
ALTER TABLE "job_fits" ADD CONSTRAINT "job_fits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_fits" ADD CONSTRAINT "job_fits_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

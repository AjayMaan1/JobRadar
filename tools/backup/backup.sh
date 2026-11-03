#!/usr/bin/env bash
# JobRadar backup (audit NEW-02): Postgres custom-format dump + object store tarball, encrypted at rest when
# BACKUP_PASSPHRASE is set, with retention. Safe to run from cron while the app is live (pg_dump is consistent).
#
#   tools/backup/backup.sh                       # uses .env (DATABASE_URL, STORAGE_LOCAL_ROOT)
#   BACKUP_DIR=/mnt/backups tools/backup/backup.sh
#
# Env: BACKUP_DIR (default ./backups) · BACKUP_KEEP_DAILY (7) · BACKUP_KEEP_WEEKLY (4) · BACKUP_PASSPHRASE (optional,
#      age/openssl symmetric) · BACKUP_REMOTE (optional rclone remote, e.g. "s3:jobradar-backups") · HEALTHCHECK_URL (optional ping)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
[ -f .env ] && set -a && . ./.env && set +a
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DAY="$(date -u +%u)"   # 1..7, 7 = Sunday → weekly
KIND=$([ "$DAY" = "7" ] && echo weekly || echo daily)
OUT="$BACKUP_DIR/$KIND/$STAMP"
mkdir -p "$OUT"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "[backup] $KIND → $OUT"
# 1. Database (custom format: compressed, restorable table-by-table with pg_restore)
pg_dump --format=custom --no-owner --no-privileges --file="$TMP/db.dump" "$DATABASE_URL"
# 2. Object store (uploaded resumes + rendered versions). S3 users: rely on bucket versioning/replication instead.
if [ "${STORAGE_DRIVER:-local}" = "local" ]; then
  ROOT_OBJ="${STORAGE_LOCAL_ROOT:-./data/objects}"
  if [ -d "$ROOT_OBJ" ]; then tar -C "$(dirname "$ROOT_OBJ")" -czf "$TMP/objects.tgz" "$(basename "$ROOT_OBJ")"; else : > "$TMP/objects.tgz"; fi
fi
# 3. Manifest (what was backed up, schema version) — never secrets
MIG="$(ls packages/db/prisma/migrations | grep -v lock | tail -1)"
printf '{"createdAt":"%s","kind":"%s","latestMigration":"%s","storageDriver":"%s","host":"%s"}\n' "$STAMP" "$KIND" "$MIG" "${STORAGE_DRIVER:-local}" "$(hostname)" > "$TMP/manifest.json"
# 4. Optional encryption (symmetric, openssl; decrypt with tools/backup/restore.sh)
for f in db.dump objects.tgz; do
  [ -f "$TMP/$f" ] || continue
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -salt -in "$TMP/$f" -out "$OUT/$f.enc" -pass env:BACKUP_PASSPHRASE
  else
    mv "$TMP/$f" "$OUT/$f"
  fi
done
mv "$TMP/manifest.json" "$OUT/manifest.json"
( cd "$OUT" && sha256sum -- * > SHA256SUMS )
du -sh "$OUT" | awk '{print "[backup] size " $1}'
# 5. Retention
prune() { local dir="$1" keep="$2"; [ -d "$dir" ] || return 0; ls -1d "$dir"/* 2>/dev/null | sort | head -n -"$keep" | xargs -r rm -rf; }
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
# 6. Optional off-box copy
if [ -n "${BACKUP_REMOTE:-}" ] && command -v rclone >/dev/null; then rclone copy "$OUT" "$BACKUP_REMOTE/$KIND/$STAMP" --quiet && echo "[backup] copied to $BACKUP_REMOTE"; fi
# 7. Dead-man's switch ping (healthchecks.io / cronitor) — silence = backups stopped
[ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" >/dev/null || true
echo "[backup] done"

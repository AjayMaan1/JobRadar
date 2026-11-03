#!/usr/bin/env bash
# Restore drill (audit NEW-02): restore the newest backup into a scratch database and check it migrates cleanly.
# Run weekly from cron or in CI; a backup that cannot be restored is not a backup.
#   tools/backup/verify.sh [backup-dir]   (default: newest under $BACKUP_DIR)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
[ -f .env ] && set -a && . ./.env && set +a
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
SRC="${1:-$(ls -1d "$BACKUP_DIR"/daily/* "$BACKUP_DIR"/weekly/* 2>/dev/null | sort | tail -1)}"
[ -n "$SRC" ] || { echo "no backups found under $BACKUP_DIR"; exit 1; }
BASE="${DATABASE_URL:?}"
SCRATCH_NAME="jobradar_restore_drill_$$"
ADMIN="${BASE%/*}/postgres"
psql -q "$ADMIN" -c "CREATE DATABASE $SCRATCH_NAME" >/dev/null
SCRATCH="${BASE%/*}/$SCRATCH_NAME"
cleanup() { psql -q "$ADMIN" -c "DROP DATABASE IF EXISTS $SCRATCH_NAME" >/dev/null || true; }
trap cleanup EXIT
tools/backup/restore.sh "$SRC" --db "$SCRATCH" --objects "$(mktemp -d)/objects" --yes
DATABASE_URL="$SCRATCH" npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma >/dev/null
USERS=$(psql -At "$SCRATCH" -c "select count(*) from users"); JOBS=$(psql -At "$SCRATCH" -c "select count(*) from jobs")
echo "[verify] PASS — restored $SRC: users=$USERS jobs=$JOBS, migrations apply cleanly"

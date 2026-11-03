#!/usr/bin/env bash
# Restore a backup produced by backup.sh into a (new, empty) database and object-store root.
#
#   tools/backup/restore.sh <backup-dir> [--db postgresql://...] [--objects /path/to/objects] [--yes]
#
# Defaults to DATABASE_URL / STORAGE_LOCAL_ROOT from .env. Refuses to restore into a non-empty database unless
# --yes is given (it will DROP the public schema first). Use a scratch DB to verify a backup (see CI "restore-drill").
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
[ -f .env ] && set -a && . ./.env && set +a
SRC="${1:?backup directory required}"; shift || true
DB="${DATABASE_URL:-}"; OBJ="${STORAGE_LOCAL_ROOT:-./data/objects}"; YES=0
while [ $# -gt 0 ]; do case "$1" in --db) DB="$2"; shift 2;; --objects) OBJ="$2"; shift 2;; --yes) YES=1; shift;; *) echo "unknown arg $1"; exit 2;; esac; done
: "${DB:?--db or DATABASE_URL required}"
[ -f "$SRC/manifest.json" ] || { echo "no manifest in $SRC"; exit 1; }
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) && echo "[restore] checksums OK"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
dec() { if [ -f "$SRC/$1.enc" ]; then : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE required for encrypted backup}"; openssl enc -d -aes-256-cbc -pbkdf2 -in "$SRC/$1.enc" -out "$TMP/$1" -pass env:BACKUP_PASSPHRASE; elif [ -f "$SRC/$1" ]; then cp "$SRC/$1" "$TMP/$1"; fi; }
dec db.dump; dec objects.tgz
TABLES=$(psql -At "$DB" -c "select count(*) from information_schema.tables where table_schema='public'")
if [ "$TABLES" != "0" ] && [ "$YES" != "1" ]; then echo "[restore] target database is not empty ($TABLES tables). Re-run with --yes to drop and restore."; exit 1; fi
if [ "$TABLES" != "0" ]; then psql -q "$DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"; fi
pg_restore --no-owner --no-privileges --dbname="$DB" "$TMP/db.dump"
echo "[restore] database restored ($(psql -At "$DB" -c "select count(*) from information_schema.tables where table_schema='public'") tables)"
if [ -s "$TMP/objects.tgz" ]; then mkdir -p "$OBJ" && tar -C "$(dirname "$OBJ")" -xzf "$TMP/objects.tgz" && echo "[restore] objects restored to $OBJ"; fi
echo "[restore] latest migration in backup: $(grep -o '"latestMigration":"[^"]*"' "$SRC/manifest.json")"
echo "[restore] now run: pnpm db:migrate:deploy   (applies any migrations newer than the backup)"

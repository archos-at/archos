#!/bin/sh
# Runs one registered SQL backfill: dry run, apply, dry run again. Prints one
# JSON line per store and one for the backfill, and exits 1 while any count
# stays above 0. The deploy's backfill Jobs run it as the database owner
# (APP_MIGRATION_DATABASE_URL), and so does scripts/rls-test-db.sh, twice.
#
#   run-sql.sh <name> <phase> <dry-run.sql> <apply.sql>
set -eu

name=$1 phase=$2 dry=$3 apply=$4
url=${APP_MIGRATION_DATABASE_URL:?APP_MIGRATION_DATABASE_URL is the owner URL the backfill runs as}

until pg_isready -d "$url" >/dev/null 2>&1; do echo "waiting for postgres"; sleep 2; done

counts() { psql "$url" -X -q -A -t -F '|' -v ON_ERROR_STOP=1 -f "$dry"; }

before=$(counts)
psql "$url" -X -q -v ON_ERROR_STOP=1 -f "$apply" >/dev/null
after=$(counts)

awk -v name="$name" -v phase="$phase" -v before="$before" -v after="$after" '
  function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
  BEGIN {
    nb = split(before, B, "\n"); na = split(after, A, "\n")
    if (nb != na || nb == 0) {
      printf "{\"event\":\"backfill.failed\",\"backfill\":\"%s\",\"phase\":\"%s\",\"reason\":\"the dry run returned %d rows before and %d after\"}\n", esc(name), esc(phase), nb, na
      exit 1
    }
    left = 0; total_before = 0; total_after = 0
    for (i = 1; i <= nb; i++) {
      split(B[i], b, "|"); split(A[i], a, "|")
      if (b[1] != a[1]) {
        printf "{\"event\":\"backfill.failed\",\"backfill\":\"%s\",\"phase\":\"%s\",\"reason\":\"row %d names %s before and %s after\"}\n", esc(name), esc(phase), i, esc(b[1]), esc(a[1])
        exit 1
      }
      written = b[2] - a[2]; if (written < 0) written = 0
      printf "{\"event\":\"backfill.count\",\"backfill\":\"%s\",\"phase\":\"%s\",\"store\":\"%s\",\"before\":%d,\"written\":%d,\"after\":%d}\n", esc(name), esc(phase), esc(b[1]), b[2], written, a[2]
      total_before += b[2]; total_after += a[2]
      if (a[2] > 0) left = 1
    }
    written = total_before - total_after; if (written < 0) written = 0
    printf "{\"event\":\"backfill.%s\",\"backfill\":\"%s\",\"phase\":\"%s\",\"before\":%d,\"written\":%d,\"after\":%d}\n", left ? "failed" : "done", esc(name), esc(phase), total_before, written, total_after
    exit left
  }
'

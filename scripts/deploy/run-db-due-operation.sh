#!/usr/bin/env bash
set -euo pipefail
mode="$1"
commit="$2"
case "$mode" in health|ingest|drain) ;; *) exit 2 ;; esac
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/opt/festival-radar
release="$root/releases/$commit"
[[ "$(readlink -f "$root/current" 2>/dev/null || true)" == "$release" ]] || exit 4
[[ -f "$release/DEPLOYED_COMMIT" && "$(cat "$release/DEPLOYED_COMMIT")" == "$commit" ]] || exit 4
[[ -x "$release/.runtime/node" && -f "$release/scripts/report-db-due-health.mjs" ]] || exit 4
cd "$release"
umask 077
case "$mode" in
  health) exec "$release/.runtime/node" scripts/report-db-due-health.mjs ;;
  ingest)
    output="$(mktemp -d /opt/festival-radar/shared/.db-due.XXXXXXXX 2>/dev/null)" || { echo 'DB due output unavailable' >&2; exit 1; }
    trap 'rm -rf -- "$output" 2>/dev/null' EXIT
    # Worker diagnostics stay inside the private, short-lived output directory.
    # Never forward stderr itself: it can contain URLs, IDs or exception text.
    worker_stderr="$output/worker.stderr"
    (: > "$worker_stderr") 2>/dev/null || { echo 'DB due diagnostics unavailable' >&2; exit 1; }
    # systemd does not inherit the GitHub dispatch environment. Pin provenance to
    # the release SHA already checked against current and DEPLOYED_COMMIT.
    if ! ( GITHUB_SHA="$commit" "$release/.runtime/node" scripts/ingest-festivals.mjs --db-due --publish --max-fetch-errors=0 "--output=$output" >/dev/null 2>"$worker_stderr" ) 2>/dev/null; then
      # Fail closed on oversized/malformed diagnostics. The only relayed value
      # is one exact, compile-time allowlisted label, never a worker line.
      stage=; stage_count=0; invalid_stage=false
      stderr_size="$(stat -c %s -- "$worker_stderr" 2>/dev/null || true)"
      if [[ "$stderr_size" =~ ^[0-9]+$ ]] && (( stderr_size > 0 && stderr_size <= 65536 )); then
        while IFS= read -r line || [[ -n "$line" ]]; do
          if [[ "$line" == *db_due_failure_stage=* ]]; then
            case "$line" in
              db_due_failure_stage=claim|db_due_failure_stage=source_setup|db_due_failure_stage=source_lookup|db_due_failure_stage=fetch|db_due_failure_stage=extraction|db_due_failure_stage=attempt_persistence|db_due_failure_stage=artifact_write|db_due_failure_stage=publication|db_due_failure_stage=lease_completion|db_due_failure_stage=result_recording|db_due_failure_stage=run_finalization)
                stage="${line#db_due_failure_stage=}"; (( stage_count += 1 ));;
              *) invalid_stage=true;;
            esac
          fi
        done < "$worker_stderr"
        [[ "$(stat -c %s -- "$worker_stderr" 2>/dev/null)" == "$stderr_size" ]] || invalid_stage=true
      fi
      if [[ "$invalid_stage" == false && "$stage_count" == 1 ]]; then
        # systemd appends stdout to the root-owned audit; stderr is /dev/null.
        printf 'DB_DUE_FAILURE_STAGE %s\n' "$stage"
      fi
      echo 'DB due ingestion failed' >&2
      exit 1
    fi
    "$release/.runtime/node" scripts/report-db-due-pilot.mjs "$output/summary.json" || { echo 'DB due pilot audit failed' >&2; exit 1; } ;;
  drain)
    "$release/.runtime/node" scripts/drain-ingestion-notifications.mjs --db-due >/dev/null 2>&1 || { echo 'DB due outbox drain failed' >&2; exit 1; } ;;
esac

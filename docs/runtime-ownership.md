# Runtime ownership

GitHub Actions only validates/builds source changes and deploys releases.
Only `.github/workflows/quality.yml` and `deploy.yml` are allowed. Runtime and
one-off diagnostic Actions have been removed, not retained as manual dispatches.
Older cutover documents are historical evidence; their GitHub dispatch commands
must not be used or restored.

The production application server owns source due scheduling/imports, source
monitoring, artist identities and Spotify statistics, the database playlist
queue, notifications and analytics retention. Existing systemd services and
application leases/locks remain unchanged by the Actions retirement. Ingestion
publication queues playlist work; a GitHub dispatch is not needed. Import repair
requests use the existing direct event transport, not a GitHub or model poller.

## Files versus database state

PostgreSQL is authoritative for catalogues, configured sources, ingestion state,
provider bindings, playlist plans and publication/retry state. Production does
not write a catalogue overlay into repository data files or commit provider
results to GitHub.

Files still have explicit operational purposes:

- `shared/collection-jobs/*/latest.json` and scheduler status JSON are local
  diagnostics, not an alternative catalogue or playlist queue.
- The playlist worker creates private per-attempt JSON for the Node/Python
  subprocess interface and removes its directory in `finally`. Durable plans and
  ambiguous provider-write reservations stay in PostgreSQL across retries.
- Ingestion runners can write diagnostic artifacts; the DB-due pilot uses a
  private temporary directory with an exit cleanup trap.
- Locks, the current-release symlink, protected credentials and event-delivery
  receipts are runtime infrastructure, not catalogue compatibility exports.
- Old collection output files may remain as historical artifacts; their presence
  does not mean an inactive legacy timer is still writing them.

Removing runtime Actions does not remove these files, reset queue state, run a
provider refresh, change existing playlist URLs or alter server schedules.

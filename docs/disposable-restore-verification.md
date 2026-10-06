# Disposable PostgreSQL restore verification (#210 prerequisite)

This is a **non-production rehearsal**, not proof that a production backup was restored. Plesk nightly backups and existing timers remain unchanged. Do not remove the file fallback based on this script or a synthetic test.

Run: bash scripts/backup/verify-disposable-restore.sh /absolute/trusted.dump /absolute/expected-counts.json

The trusted PostgreSQL **custom-format** archive is restored in a newly created PostgreSQL 16 Docker container with no network, published ports, host mounts, supplied database target or production credential path. The script never reads DATABASE_URL; its private database is destroyed at exit. Do not pass an untrusted archive: a dump contains executable SQL. Run only on a trusted isolated host with free disk for a second archive copy and the restored database; do not run on a space-constrained production host.

Capture the manifest **independently at backup time** with read-only source queries: SELECT count(*) FROM "Festival"; and likewise FestivalEdition, Artist, FestivalSource, FestivalPlaylist, AssetBlob, FestivalLogo. Save these seven integer values under counts and the SHA-256 digest of the trusted archive after decryption under sha256. Example shape (replace zeros and hash with independently measured values):

    {"sha256":"<64 lowercase hex digits>","counts":{"Festival":0,"FestivalEdition":0,"Artist":0,"FestivalSource":0,"FestivalPlaylist":0,"AssetBlob":0,"FestivalLogo":0}}

Handle decrypted archives/manifest under existing backup access controls; do not commit either. The verifier rejects a mismatched checksum before starting a container. A matching digest, transactional restore and seven row-count comparisons prove only this archive's basic structural/count parity, not full content, point-in-time consistency, external services, asset bytes, encryption, nightly Plesk backup quality, production permissions or recovery time. Archive provenance and full restore/rollout acceptance still need operator review and a separately authorized production-backup rehearsal before #210's fallback-removal gate is considered passed.

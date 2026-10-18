# Independent provider publication

The existing database playlist worker retains one durable two-provider queue job.
After Spotify's complete ordered provider read-back, a lease-fenced transaction
may publish its binding and metadata before YouTube finishes. It validates the
current edition, expected binding, durable creation ID, plan counts and absence
of a newer completed publication. Missing proof, binding races and stale leases
roll back both binding publication and plan normalization.

Only the durable plan's Spotify URL/ID are normalized to the now-published
binding; selected artists and ordered track URIs remain unchanged. A retry reads
that same binding and plan and never repeats playlist creation. The job remains
RUNNING/FAILED while YouTube is incomplete. YouTube's existing exact ordered
read-back, ownership, pending-insertion and quota-resume safeguards are unchanged.
Final SUCCEEDED still requires the requested YouTube result to be complete.

Verified Rockharz lineup changes also use the normal transactional queue, with
its exact official-source/edition/persisted-evidence guard retained. Ticket-only,
status-only and unchanged publications never create a playlist job; publication
replay reuses its existing queue relation.

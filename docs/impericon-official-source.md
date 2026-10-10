# Impericon official-source automation

The `impericon` official-markup adapter recognizes the edition-bound 2027
announcement at
`https://www.impericon.com/blogs/festival/impericon-festival-2027-new-line-up-drop`.
It reads explicit headliner wording, the announcement's eight bold artist
names, the partial-announcement marker and its uniquely dated weekend ticket.
Navigation, merchandise, the author biography and historical news are excluded.
Ticket availability is deliberately not inferred from dated article prose.

This is a **dated announcement**, not an evergreen lineup grid. The official
festival landing page currently exposes the complete bill as an image. A new
announcement needs its own reviewed source binding and parser support. Changed
names, dates, edition, article identity or incomplete markup yield no fields
and a review warning; they never silently remove the existing lineup or add
unverified artists. Future publication remains subject to normal ingestion
review and playlist-effect checks.

Deploy the registered adapter before switching the existing, edition-bound
manual source to the exact article URL, `official_markup:impericon` and daily
cadence. Clear only that source's obsolete fetch validators; keep its identity
and edition binding. Use the existing fenced DB-due timer, not a second worker.
Before switching, compare a real-page candidate with the live catalogue: the
already populated edition should have five evidence fields and zero changes.
Read back the automatic attempt, candidate, next run, leases and provider queue.

Official logo bytes belong in the DB content-addressed asset store, not this
repository. Logo binding and parser activation are separately audited actions.

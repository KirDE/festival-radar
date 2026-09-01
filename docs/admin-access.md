# Administrative access

<<<<<<< HEAD
Administrative access is deny-by-default and uses two independent server-side gates. The account email must be present in the protected `ADMIN_EMAILS` deployment allowlist, and its persisted database role must be `EDITOR` or `ADMIN`. The allowlist never grants privileges to a `USER` by itself. `EDITOR` may read the console, review changes, and save drafts, while only `ADMIN` may trigger refresh operations. Mutations additionally require a same-origin `Origin` header, and every accepted mutation records the authenticated session user in `AdminAuditEntry`.
=======
Administrative access is deny-by-default. New accounts receive `USER`; `EDITOR` may read the console, review changes, and save drafts, while only `ADMIN` may trigger refresh operations. Both the page and API enforce roles server-side. Every cookie-authenticated mutation, including logout, requires an exact same-origin `Origin` header before it may change session or database state, and every accepted administrative mutation records the authenticated session user in `AdminAuditEntry`.

Requests with a missing, opaque (`null`), malformed, path-bearing, or foreign `Origin` fail closed with 403. Production-owned service routes use a separate bearer-token boundary and intentionally do not use the browser-origin guard; cookie-authenticated non-browser clients must send the configured application origin explicitly.
>>>>>>> 20517a6 (Enforce trusted origins on session mutations)

Role assignment is an operator-only database operation. From a trusted deployment shell with `DATABASE_URL` configured, run:

```sh
npm run admin:assign-role -- editor@example.com EDITOR --confirm
```

Use `USER` to revoke access. Review the target email and requested role before confirmation. The application exposes no public role-assignment endpoint.

After deployment, smoke-test `/admin` and `/api/admin` as anonymous, an allowlisted ordinary user, editor, and administrator accounts. Anonymous and ordinary-user requests must be denied, including when the ordinary user's email is allowlisted. Editors must be denied refresh with 403, and administrators must be able to trigger a refresh. Cross-origin mutation requests must return 403 for every role.

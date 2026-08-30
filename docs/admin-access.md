# Administrative access

Administrative access is deny-by-default. New accounts receive `USER`; `EDITOR` may read the console, review changes, and save drafts, while only `ADMIN` may trigger refresh operations. Both the page and API enforce roles server-side. Mutations additionally require a same-origin `Origin` header, and every accepted mutation records the authenticated session user in `AdminAuditEntry`.

Role assignment is an operator-only database operation. From a trusted deployment shell with `DATABASE_URL` configured, run:

```sh
npm run admin:assign-role -- editor@example.com EDITOR --confirm
```

Use `USER` to revoke access. Review the target email and requested role before confirmation. The application exposes no public role-assignment endpoint.

After deployment, smoke-test `/admin` and `/api/admin` as anonymous, ordinary-user, editor, and administrator accounts. Anonymous API requests must return 401, ordinary users 403, editors must be denied refresh with 403, and administrators must receive 202 for same-origin mutations. Cross-origin mutation requests must return 403 for every role.

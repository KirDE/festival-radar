# Dependency security maintenance

Keep the runtime on Prisma 6 while resolving its CLI-only transitive advisories.
`@prisma/config` is scoped to patched `deepmerge-ts` 8.0.2 via an npm override;
Prisma 6.19.3 otherwise still pins the vulnerable 7.x line. The public `deepmerge`
API used by config remains available. Remove the override after upstream supports
a patched version directly; do not migrate the database runtime to Prisma 7 only
to repair this CLI dependency.

For updates, verify `npm ci`, Prisma generation/config loading, migration deploy,
the disposable PostgreSQL repository/lease/publication suites, build and browser
acceptance. Both workflows enforce `npm audit --audit-level=high`.

GitHub Actions are pinned to official release commits with human-readable
version comments. Upgrade setup-node/setup-python together with checkout;
legacy action bundles, rather than application imports, emitted the CI
`DEP0040` punycode warning.

Dependabot covers npm, GitHub Actions and the pinned Python requirements.
Python artifact updates must still satisfy the release's Python3.9 import and
wheel-metadata checks; do not bypass Requires-Python to clear an alert. Requests
2.33/urllib3 2.8 require Python>=3.10 and are not part of the npm remediation.
Track their migration separately rather than silently breaking playlist jobs.

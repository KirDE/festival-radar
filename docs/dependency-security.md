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

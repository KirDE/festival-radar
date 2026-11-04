# Loud Weekend branding and domain cutover

The product is **Loud Weekend**, the repository is
<https://github.com/KirDE/loud-weekend>, and the intended public origin is
<https://loudweekend.eu>. The festival named Heavy Week-End is unrelated and its
catalogue entry must not be renamed.

## Compatibility identifiers

Existing production service names, deployment users, filesystem paths, database
identities, local browser storage keys, calendar event UIDs and provider creation
markers remain stable compatibility identifiers, not public branding. Renaming
them by text substitution can lose saved plans, duplicate calendar/provider
objects, break deployment privileges, or bypass the shared worker lock. Existing
GitHub pull-request references remain accepted alongside the renamed repository.
No catalogue or provider objects are reset or recreated by this change.

## Domain activation checklist

1. Verify ownership and DNS for `loudweekend.eu` and provision its HTTPS vhost
   on the existing application origin. Do not purchase a domain implicitly.
2. Add the exact new callback URI to the existing Spotify application's allowed
   redirects before switching `APP_URL`; preserve client credentials and tokens.
3. Set `APP_URL=https://loudweekend.eu` and the deployment `APP_DOMAIN` to
   `loudweekend.eu`, retaining the existing database and application secrets.
   Build and deploy this release only after the new hostname and TLS are ready:
   metadata, sitemap, notification URLs and deployment acceptance target it.
4. Verify EN/DE/RU, login/password flow, account and planner, canonical URLs,
   PWA metadata/icons, health SHA, original playlist URLs and worker schedules.
5. After acceptance, return HTTP **302** from the former origin to the new
   hostname, preserving the original path and query. Sessions and browser-only
   plans are origin-scoped and do not cross domains automatically. Existing
   passkeys are bound to the former RP ID; password sign-in and new passkey
   registration remain available on the new origin. Do not delete credentials
   or claim automatic cross-origin migration. Redirects must preserve paths and
   queries, and must not redirect provider callbacks until their registration
   has been updated.

The DNS/HTTPS and provider-console steps require live verification independently
of code checks; a renamed GitHub repository is not proof of domain delivery.

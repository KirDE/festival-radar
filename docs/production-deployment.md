# Production deployment access

Production uses the unprivileged `festival-radar-deploy` account. Its SSH key may
write only to `/var/lib/festival-radar-deploy/incoming`; it has no interactive
root access. The only permitted sudo command is the root-owned
`/usr/local/libexec/festival-radar/activate-release` wrapper with a commit SHA.
The wrapper rejects unexpected callers, paths, symlinks, owners, and commit
formats before invoking the reviewed installer.

Provision or rotate the key from a trusted root checkout:

```bash
sudo bash scripts/deploy/bootstrap-deploy-user.sh /path/to/reviewed-public-key
```

Verify with `ssh production id` and
`ssh production sudo -n /usr/local/libexec/festival-radar/activate-release 0000000000000000000000000000000000000000`.
The first must report the deploy user; the second must reach the wrapper and
reject the missing deployment inputs. Roll back by restoring the previous authorized key
and root-owned wrapper files from the server backup. Remove obsolete root key
authorization only after a successful deployment and external health checks.

## Notification scheduler

Deployments install `festival-radar-notifications.timer` on the production host.
It invokes the authenticated loopback dispatcher every ten minutes, uses `flock`
to prevent overlap, and records only timestamps and aggregate statuses in the
shared scheduler-state file. GitHub Actions retains a manual diagnostic dispatch
but is not the production scheduler.

Verify ownership and cadence with `systemctl status
festival-radar-notifications.timer`, `systemctl list-timers
festival-radar-notifications.timer`, and
`journalctl -u festival-radar-notifications.service`. The public
`/api/health/notification-scheduler/` endpoint returns 503 when the last
successful completion is missing, failed, or older than twenty minutes. A failed
unit is retried on the next timer interval; after correcting the underlying
secret, provider, or application failure, run `systemctl start
festival-radar-notifications.service` and verify the health endpoint returns 200.

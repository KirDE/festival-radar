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

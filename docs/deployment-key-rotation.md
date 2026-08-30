# Production deployment key rotation

Festival Radar deployments use the GitHub `production` environment secrets
`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_PORT`, and `DEPLOY_KNOWN_HOSTS`. Keep
the private key only in the environment secret and install only its public half
on the production server.

## Install or rotate

1. Generate a dedicated Ed25519 key pair on a trusted administration host. Do
   not reuse a personal login key and do not print the private key in logs.
2. Add the new public key to the production deploy account's
   `authorized_keys`. Keep the previous public key temporarily so rollback is
   possible.
3. From a trusted host, verify the new key non-interactively with strict host
   checking enabled:

   ```sh
   ssh -o BatchMode=yes -o IdentitiesOnly=yes \
     -i /secure/path/new_deploy_key deploy-host true
   ```

4. Replace `DEPLOY_SSH_KEY` in the GitHub `production` environment. Confirm
   that `DEPLOY_HOST`, `DEPLOY_PORT`, and `DEPLOY_KNOWN_HOSTS` still describe
   the same production endpoint.
5. Dispatch the production workflow. Its **Preflight SSH access** step must
   pass before packaging or upload, and the workflow must complete upload,
   activation, and production verification.
6. Remove the previous public key only after the successful deployment has
   been independently verified. If verification fails, restore the previous
   secret and leave the previous public key installed while investigating.

The preflight intentionally suppresses raw SSH diagnostics so host material and
credential details cannot be copied into Actions logs. Use a trusted
administration host for detailed diagnosis.

# Guarded CampusBite recovery

This workflow targets only `f5bdd829cd49aec9369e69834b285c9c82ccedcd`
in zestful-healing / production / campusbite. It does not modify Railway
variables, credentials, source settings, persistent volumes, or backup files.
First application startup performs the approved schema 7 → 12 migration.
Payments must stay disabled.

## Cloud behavior

After this PR is merged to the default branch, GitHub-hosted Linux runners perform
secret-free gate tests and public status checks twice per hour. The computer can
be asleep or off. Public status never authorizes a deployment. GitHub schedules
can be delayed and are disabled after 60 days of public-repository inactivity.
No local heartbeat or screen automation is used.

A release is a separate `workflow_dispatch` with `deploy=true` and an opaque
`gate_id`. It runs candidate tests/lint/build in a job without Railway secrets.
The release job also requires the exact commit in the repository variable
`CAMPUSBITE_RECOVERY_ARMED`, a protected environment approval, and matching fresh
private evidence. Missing setup leaves deployment disabled. Schedule events
cannot deploy. There is no push-triggered deployment.

Use only the reviewed workflow on `main`. Reviewers approve a concrete cloud run
after all gates are satisfied; once approved, deployment and verification run
without the local screen or another prompt. This is an intentionally bounded
recovery run, not indefinite automatic deployment based on a status-page change.

## Owner actions before arming

1. Obtain written Railway confirmation for workspace/project/environment/service
   IDs in `gates.mjs`. A healthy public status page, account access or READY volume
   does not establish Trial workspace deployment eligibility. Keep evidence private.
2. Complete the security review and rotate retained credentials privately; revoke
   dormant credentials and any exposed tokens. Review Git history, logs, Railway
   staged changes, provider selections and old integrations. Do not print values.
   Do not change production credentials before the eligibility/security gates allow
   that work. This automation never rotates credentials on its own.
3. Hold a write freeze, create a fresh consistent SQLite snapshot with SQLite's
   backup API, encrypt it using the existing authenticated encryption procedure,
   and retain an off-volume encrypted copy. Privately verify authenticated
   decryption, schema 7, integrity `ok`, zero foreign-key violations, and a disposable
   rehearsal to schema 12 with original rows preserved. Perform a real isolated
   restore test. Retain a volume snapshot, the compatible rollback source commit,
   and a verified stop/restore procedure. Never upload backup data, decryption keys
   or customer records to this PUBLIC repository or its Actions artifacts/logs.
4. Recheck one replica, `/app/data/campusbite.db`, Node 24 (`RAILPACK_NODE_VERSION=24`),
   the effective port/domain, `NODE_ENV=production`, MSG91 configured, and disabled
   development accounts/reset. `CAMPUSBITE_PAYMENT_PROVIDER=disabled` and
   `CAMPUSBITE_LIVE_PAYMENTS_APPROVED=false` are mandatory. Set any missing approved
   settings privately only after the corresponding gates. Keep Railway automatic
   deployments disabled and inspect any staged changes. The workflow changes none
   of these settings.
5. In GitHub environment `campusbite-recovery-f5bdd82`, configure the owner as
   required reviewer, no administrator bypass, and only branch `main`. Use environment
   secrets only: `RAILWAY_TOKEN` (a new Railway project token scoped to this production
   environment) and `RELEASE_GATE_JSON` (private evidence metadata). Never use
   `RAILWAY_API_TOKEN`, a Railway account token, a GitHub PAT, or provider keys in
   this workflow. The built-in GitHub token has contents/actions read access only.
   Check the Railway project token supports status/variables/up/SSH/down in a
   disposable environment before arming. If project tokens cannot perform the
   required read/SSH/stop checks, STOP: implement an approved narrowly scoped
   verification/recovery integration; do not substitute an account token.
6. Prepare `RELEASE_GATE_JSON` following `gate.example.json`, using real privately
   verified evidence. All `false`, empty fields and placeholder timestamps are
   intentionally invalid. Evidence binds the reviewed automation commit, exact
   target and gate ID. Gate verification expires in 30 minutes; backup creation
   expires in 60 minutes. Approval delays require fresh evidence and a new run.
   Evidence IDs are opaque references to private records, not links containing
   credentials. Environment-secret access and the required review establish the
   attestation's trust; boolean assertions alone are not independent backup,
   rotation or eligibility verification. Never mark an unverified gate true.
7. Set the repository arming variable to the exact target SHA, dispatch once with
   the matching gate ID, inspect validation results, and approve the environment
   job within the evidence window. Keep a recovery operator available remotely.
   After success or failure, disarm by deleting the arming variable and revoke the
   short-lived Railway deployment token. No new credential should be pasted in chat.

## Recovery behavior and limits

Before upload, the runner checks exact project/workspace/service/volume IDs,
offline service state, mount, listener, selected safe configuration and source SHA.
It uploads a clean `git archive` of the requested commit, not the automation branch
or a dirty directory. Provider output stays captured in memory and is never echoed.

After startup, it checks HTTPS health and uses Railway SSH to read schema 12,
SQLite integrity/foreign keys, disabled payment configuration, and SHA-256 hashes
of the deployed server/shared/package files. SSH runs a read-only SQLite probe
without importing application initialization or returning any data rows.

If upload or verification fails, the workflow attempts `railway down` against this
exact service and retains the volume. It never automatically rolls back code or
restores a v7 database over a v12 database. If the stop fails, the workflow fails
with a remote-operator action message. The operator must verify the stop, privately
inspect state, restore the verified pre-migration snapshot only under the approved
write freeze, and recheck integrity/compatible code before a newly reviewed run.
GitHub failure/cancellation notifications should be enabled for the owner. Do not
cancel an in-flight deployment: cancellation/platform failure can prevent cleanup;
the remotely available recovery operator must handle that case. No workflow can
guarantee recovery while both its runner and the provider control plane are down.

The gate ID cannot be reused within the bounded workflow history. Workflow reruns
are forbidden. A changed or active service blocks another attempt. Authentication,
OTP delivery, frontend routing and user sign-off remain separate from backend
deployment verification. A health response alone never proves schema or release.

References: [Railway CI/project tokens](https://docs.railway.com/cli/deploying),
[GitHub environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

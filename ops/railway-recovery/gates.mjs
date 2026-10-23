import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

export const target = Object.freeze({
  commit: 'f5bdd829cd49aec9369e69834b285c9c82ccedcd',
  workspace: 'c1bfc1f7-628e-44ee-9429-4a5d1d6910f9',
  project: '8746c632-7e25-4ad9-87ba-aefb90206e17',
  environment: '36922ba5-de10-4a30-a011-f7bee14873c1',
  service: 'bb34b248-9ccc-4682-b1a8-91679cd986f6',
  volume: 'c155a062-2f20-4d70-b4d1-8b10d92f7f24',
})

// Private owner-reviewed attestations are required for facts the deployment
// token cannot establish. A public status page is deliberately insufficient.
export function validateGate(g, requestedId, now = Date.now()) {
  assert(g && g.version === 1, 'Missing gate evidence')
  assert(/^[A-Za-z0-9_-]{16,80}$/.test(requestedId || ''), 'Invalid gate ID')
  assert.equal(g.gateId, requestedId, 'Gate ID mismatch')
  assert.deepEqual(g.target, target, 'Wrong deployment target')
  assert.equal(g.workflowCommit, process.env.GITHUB_SHA || g.workflowCommit)
  assert(/^[a-f0-9]{40}$/.test(g.workflowCommit || ''), 'Missing reviewed workflow SHA')
  const fresh = (value, age) => {
    const date = Date.parse(value)
    assert(Number.isFinite(date) && date <= now && now - date <= age, 'Stale evidence')
  }
  fresh(g.verifiedAt, 30 * 60_000)
  assert(Date.parse(g.expiresAt) > now && Date.parse(g.expiresAt) <= Date.parse(g.verifiedAt) + 30 * 60_000, 'Expired gate')
  for (const group of ['eligibility', 'credentials', 'backup', 'recovery']) {
    assert(typeof g[group]?.evidenceId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(g[group].evidenceId), 'Missing private evidence reference')
  }
  assert.equal(g.eligibility.workspaceSpecificConfirmation, true)
  assert.equal(g.credentials.retainedCredentialsRotated, true)
  assert.equal(g.credentials.dormantCredentialsRevoked, true)
  assert.equal(g.credentials.noSecretsInGitOrLogs, true)
  assert.equal(g.credentials.projectTokenEnvironmentScoped, true)
  assert.equal(g.credentials.cliCapabilitiesVerified, true)
  fresh(g.credentials.verifiedAt, 24 * 60 * 60_000)
  fresh(g.backup.createdAt, 60 * 60_000)
  assert(/^[a-f0-9]{64}$/.test(g.backup.ciphertextSha256 || ''))
  assert.equal(g.backup.authenticatedDecryptionVerified, true)
  assert.equal(g.backup.encryptedOffVolumeCopy, true)
  assert.equal(g.backup.sourceSchema, 7)
  assert.equal(g.backup.integrity, 'ok')
  assert.equal(g.backup.foreignKeyViolations, 0)
  assert.equal(g.backup.rehearsalSchema, 12)
  assert.equal(g.backup.originalRowsPreserved, true)
  assert.equal(g.backup.restoreTestPassed, true)
  for (const flag of ['writeFreezeHeldUntilVerification', 'autoDeployDisabled', 'stagedChangesReviewed', 'restoreOperatorAvailable', 'stopAndRestoreProcedureVerified', 'volumeSnapshotAvailable']) {
    assert.equal(g.recovery[flag], true, `Recovery gate missing: ${flag}`)
  }
  assert(/^[a-f0-9]{40}$/.test(g.recovery.rollbackCodeCommit || ''))
  assert.equal(g.paymentsDisabled, true)
  return g
}

export function readGate() {
  try { return validateGate(JSON.parse(process.env.RELEASE_GATE_JSON || 'null'), process.env.REQUESTED_GATE_ID) }
  catch { throw new Error('Release blocked: missing, mismatched, stale or unverified private gate evidence. No secret values are logged.') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  readGate()
  console.log('Private release gate validated. Live target verification is still required.')
}

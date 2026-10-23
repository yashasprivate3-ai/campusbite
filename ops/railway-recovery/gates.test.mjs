import test from 'node:test'
import assert from 'node:assert/strict'
import { target, validateGate } from './gates.mjs'

const now = Date.now()
const id = 'synthetic-gate-0001'
function valid() {
  return {
    version: 1, gateId: id, target: { ...target }, workflowCommit: process.env.GITHUB_SHA || 'a'.repeat(40),
    verifiedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(),
    eligibility: { evidenceId: 'test-eligibility', workspaceSpecificConfirmation: true },
    credentials: { evidenceId: 'test-security', retainedCredentialsRotated: true, dormantCredentialsRevoked: true, noSecretsInGitOrLogs: true, projectTokenEnvironmentScoped: true, cliCapabilitiesVerified: true, verifiedAt: new Date(now).toISOString() },
    backup: { evidenceId: 'test-backup', createdAt: new Date(now).toISOString(), ciphertextSha256: 'b'.repeat(64), authenticatedDecryptionVerified: true, encryptedOffVolumeCopy: true, sourceSchema: 7, integrity: 'ok', foreignKeyViolations: 0, rehearsalSchema: 12, originalRowsPreserved: true, restoreTestPassed: true },
    recovery: { evidenceId: 'test-recovery', writeFreezeHeldUntilVerification: true, autoDeployDisabled: true, stagedChangesReviewed: true, restoreOperatorAvailable: true, stopAndRestoreProcedureVerified: true, volumeSnapshotAvailable: true, rollbackCodeCommit: 'c'.repeat(40) },
    paymentsDisabled: true,
  }
}
test('complete synthetic evidence passes', () => assert.equal(validateGate(valid(), id, now).gateId, id))
for (const [label, mutate] of [
  ['wrong commit', g => { g.target.commit = 'f'.repeat(40) }],
  ['wrong project', g => { g.target.project = 'adequate-commitment' }],
  ['wrong workspace', g => { g.target.workspace = 'other' }],
  ['wrong volume', g => { g.target.volume = 'other' }],
  ['wrong workflow revision', g => { g.workflowCommit = 'invalid' }],
  ['public status substituted', g => { g.eligibility.workspaceSpecificConfirmation = false }],
  ['unrotated credentials', g => { g.credentials.retainedCredentialsRotated = false }],
  ['dormant credentials retained', g => { g.credentials.dormantCredentialsRevoked = false }],
  ['broad token', g => { g.credentials.projectTokenEnvironmentScoped = false }],
  ['unverified token capabilities', g => { g.credentials.cliCapabilitiesVerified = false }],
  ['missing evidence reference', g => { delete g.backup.evidenceId }],
  ['stale gate', g => { g.verifiedAt = new Date(now - 31 * 60_000).toISOString() }],
  ['future gate', g => { g.verifiedAt = new Date(now + 1000).toISOString() }],
  ['expired gate', g => { g.expiresAt = new Date(now - 1).toISOString() }],
  ['unbounded authorization', g => { g.expiresAt = new Date(now + 31 * 60_000).toISOString() }],
  ['stale backup', g => { g.backup.createdAt = new Date(now - 61 * 60_000).toISOString() }],
  ['unverified decryption', g => { g.backup.authenticatedDecryptionVerified = false }],
  ['unverified restore', g => { g.backup.restoreTestPassed = false }],
  ['invalid backup digest', g => { g.backup.ciphertextSha256 = 'bad' }],
  ['wrong starting schema', g => { g.backup.sourceSchema = 12 }],
  ['failed integrity', g => { g.backup.integrity = 'failed' }],
  ['foreign key violation', g => { g.backup.foreignKeyViolations = 1 }],
  ['migration data loss', g => { g.backup.originalRowsPreserved = false }],
  ['no write freeze', g => { g.recovery.writeFreezeHeldUntilVerification = false }],
  ['no restore operator', g => { g.recovery.restoreOperatorAvailable = false }],
  ['auto deploy enabled', g => { g.recovery.autoDeployDisabled = false }],
  ['payments enabled', g => { g.paymentsDisabled = false }],
]) test(`rejects ${label}`, () => { const g = valid(); mutate(g); assert.throws(() => validateGate(g, id, now)) })
test('rejects gate ID reuse/mismatch', () => assert.throws(() => validateGate(valid(), 'other-gate-00001', now)))
test('rejects missing evidence', () => assert.throws(() => validateGate(null, id, now)))

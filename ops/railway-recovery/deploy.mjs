import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readGate, target } from './gates.mjs'

const args = ['--project', target.project, '--environment', target.environment]
const serviceArgs = [...args, '--service', target.service]
// Capture all provider output in memory. Build/application logs can contain
// secrets; never forward stdout/stderr or provider error objects into Actions.
function railway(command, options = {}) {
  try {
    return execFileSync('railway', command, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024, ...options,
    })
  } catch { throw new Error('Railway operation failed; inspect privately. Raw provider output suppressed.') }
}
function json(command) {
  try { return JSON.parse(railway(command)) }
  catch { throw new Error('Railway read-only verification failed; deployment blocked.') }
}
const gate = readGate()
assert(process.env.RAILWAY_TOKEN, 'Missing environment-scoped Railway project token')
assert(!process.env.RAILWAY_API_TOKEN, 'Account/workspace token forbidden')
assert.equal(process.env.GITHUB_REF, 'refs/heads/main')
assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1', 'Reruns forbidden; create a newly reviewed recovery run')

// A gate ID may authorize only one cloud run, including failed attempts. This
// also prevents an old signed-off recovery window being retried silently.
const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }
let foundCurrent = false
for (let page = 1; page <= 10; page++) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/campusbite-recovery.yml/runs?event=workflow_dispatch&per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(15000) })
  assert(response.ok, 'Cannot verify previous release attempts')
  const runs = (await response.json()).workflow_runs
  for (const run of runs) {
    if (String(run.id) === process.env.GITHUB_RUN_ID) foundCurrent = true
    // run-name contains the opaque gate ID, never any sensitive evidence.
    if (String(run.id) !== process.env.GITHUB_RUN_ID && run.display_title.includes(gate.gateId)) {
      throw new Error('Gate already used; investigate prior attempt and prepare fresh recovery evidence')
    }
  }
  if (runs.length < 100) break
  assert(page < 10, 'History exceeds bounded verification window; operator review required')
}
assert(foundCurrent, 'Cannot identify current workflow run')

const project = json(['status', ...args, '--json'])
assert.equal(project.id, target.project)
assert.equal(project.workspaceId, target.workspace)
const environment = project.environments.edges.find(e => e.node.id === target.environment)?.node
assert(environment?.canAccess, 'Target environment inaccessible')
const instance = environment.serviceInstances.edges.find(e => e.node.serviceId === target.service)?.node
assert(instance && instance.activeDeployments.length === 0 && !instance.latestDeployment, 'Target changed: expected offline service with no deployment')
const volume = environment.volumeInstances.edges.find(e => e.node.volume.id === target.volume)?.node
assert(volume && volume.serviceId === target.service && volume.state === 'READY' && volume.mountPath === '/app/data' && !volume.isPendingDeletion && !volume.deletedAt, 'Volume gate failed')
assert(!instance.numReplicas || instance.numReplicas === 1, 'SQLite requires one replica')
assert.equal(instance.source.repo, 'yashasprivate3-ai/campusbite')
assert(!instance.source.image, 'Unexpected image source')
assert(!instance.startCommand || ['npm start', 'npm run server'].includes(instance.startCommand), 'Unexpected start command')

const vars = json(['variable', ...serviceArgs, '--json'])
for (const [key, expected] of Object.entries({
  NODE_ENV: 'production', CAMPUSBITE_PAYMENT_PROVIDER: 'disabled',
  CAMPUSBITE_LIVE_PAYMENTS_APPROVED: 'false', CAMPUSBITE_DEV_ACCOUNTS_ENABLED: 'false',
  CAMPUSBITE_DEV_RESET_PASSWORDS: 'false', CAMPUSBITE_DB_PATH: '/app/data/campusbite.db',
  CAMPUSBITE_OTP_PROVIDER: 'msg91', RAILPACK_NODE_VERSION: '24',
})) assert.equal(vars[key], expected, `Required production setting failed: ${key}`)
assert(!vars.CAMPUSBITE_API_HOST || vars.CAMPUSBITE_API_HOST === '0.0.0.0')
assert('CAMPUSBITE_MSG91_AUTHKEY' in vars && vars.CAMPUSBITE_MSG91_AUTHKEY !== '')
assert('CAMPUSBITE_OTP_HASH_SECRET' in vars && (vars.CAMPUSBITE_OTP_HASH_SECRET === null || vars.CAMPUSBITE_OTP_HASH_SECRET.length >= 32))
const port = Number(vars.PORT || vars.CAMPUSBITE_API_PORT || 3001)
const domains = instance.domains.serviceDomains
assert(domains.length === 1 && domains[0].targetPort === port, 'Domain/listener port mismatch')
assert.equal(domains[0].domain, 'campusbite-production-6a60.up.railway.app')

const release = resolve('release')
const git = a => execFileSync('git', a, { cwd: release, encoding: 'utf8' }).trim()
assert.equal(git(['rev-parse', 'HEAD']), target.commit)
assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '', 'Dirty release directory')
// Upload a git archive, excluding checkout metadata, automation and secrets.
// The exact source SHA remains unchanged by the separate automation commit.
const files = git(['ls-files']).split('\n')
assert(!files.some(f => /(^|\/)(\.env($|\.(?!example$))|.*\.(db|sqlite|cbgcm)$)/.test(f)), 'Unexpected sensitive tracked file')
const runtimeFiles = files.filter(f => /^(server\/|shared\/|package(?:-lock)?\.json$)/.test(f))
const expected = Object.fromEntries(runtimeFiles.map(f => [f, createHash('sha256').update(readFileSync(resolve(release, f))).digest('hex')]))
const archive = resolve(process.env.RUNNER_TEMP, 'campusbite-release.tar')
execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, target.commit], { cwd: release })
const source = resolve(process.env.RUNNER_TEMP, 'campusbite-source')
execFileSync('mkdir', ['-p', source])
execFileSync('tar', ['-xf', archive, '-C', source])
readGate() // approval/tool installation/testing time may have expired the gate
console.log('All owner-attested and live preflight gates passed. Starting the approved exact source deployment.')
let attempted = false
try {
  attempted = true
  railway(['up', ...serviceArgs, '--ci', '--message', `recovery:${target.commit}:${gate.gateId}`], { cwd: source })
  const response = await fetch(`https://${domains[0].domain}/api/health`, { signal: AbortSignal.timeout(15000) })
  assert(response.ok)
  const health = await response.json()
  assert(health.status === 'ok' && health.service === 'campusbite-api')
  // Verify actual runtime bytes and database, without importing application
  // initialization or printing rows, credentials, sessions or OTPs.
  const probe = `const fs=require('node:fs'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');const expected=${JSON.stringify(expected)};for(const [f,h] of Object.entries(expected)){if(crypto.createHash('sha256').update(fs.readFileSync('/app/'+f)).digest('hex')!==h)throw Error('code');}if(process.env.CAMPUSBITE_PAYMENT_PROVIDER!=='disabled'||process.env.CAMPUSBITE_LIVE_PAYMENTS_APPROVED!=='false'||process.env.CAMPUSBITE_DB_PATH!=='/app/data/campusbite.db')throw Error('config');const db=new DatabaseSync('/app/data/campusbite.db',{readOnly:true});if(db.prepare('PRAGMA user_version').get().user_version!==12||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('database');db.close();console.log('CAMPUSBITE_RECOVERY_VERIFIED');`
  const encoded = Buffer.from(probe).toString('base64')
  const output = railway(['ssh', ...serviceArgs, '--', `node -e "eval(Buffer.from('${encoded}','base64').toString())"`])
  assert(output.includes('CAMPUSBITE_RECOVERY_VERIFIED'), 'Runtime verification unavailable')
  console.log('Deployment verified: exact runtime files, health, schema 12, integrity and disabled payments. Keep writes frozen until the operator completes recovery sign-off.')
} catch {
  if (attempted) {
    try {
      railway(['down', ...serviceArgs, '--yes'])
      console.error('Recovery failed. Deployment removed; persistent volume retained. Operator must inspect and follow the approved restore procedure before another attempt.')
    } catch {
      console.error('Recovery failed and automated stop could not be verified. Operator must stop the target service immediately and inspect the retained volume privately.')
    }
  }
  process.exitCode = 1
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { serviceStatus } from '../../src/services/serviceStatus.js'

const item = (available) => ({ live: { available } })

test('shows a checking state while the live menu is loading', () => {
  assert.equal(serviceStatus(null, [item(true)]).state, 'checking')
})

test('claims open only when the server reports available items', () => {
  const status = serviceStatus({ menu: {} }, [item(true), item(false), item(true)])
  assert.equal(status.state, 'open')
  assert.equal(status.title, 'Open for orders')
  assert.equal(status.detail, '2 items available now')
  assert.equal(serviceStatus({ menu: {} }, [item(true)]).detail, '1 item available now')
})

test('shows the founder wording when nothing is available or the menu failed', () => {
  for (const status of [
    serviceStatus({ menu: {} }, [item(false), { live: undefined }]),
    serviceStatus({ menu: {} }, []),
    serviceStatus({ error: 'Could not load' }, [item(true)]),
  ]) {
    assert.equal(status.state, 'closed')
    assert.equal(status.title, 'We will be live shortly....❤️')
  }
})

test('the home screen no longer hard-codes the live-shortly message', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const app = readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  assert.ok(!app.includes('We will be live shortly'), 'message must come from serviceStatus')
  assert.ok(!app.includes('Average pickup : 8–10 minutes'), 'static pickup claim removed')
  assert.ok(app.includes('serviceStatus(liveMenu, menuWithAvailability)'))
})

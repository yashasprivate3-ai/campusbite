import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

// Regression guard: the header "Track order" button must always give visible
// feedback. It opens tracking (or refreshes it when already open) and brings
// the tracking heading back into view, without changing the 3-second polling.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8')
const appSource = read('src/App.jsx')
const app = parse(appSource, { sourceType: 'module', plugins: ['jsx'] })

function collect(node, predicate, found = []) {
  if (!node || typeof node.type !== 'string') return found
  if (predicate(node)) found.push(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === 'string') collect(child, predicate, found)
    }
  }
  return found
}

const sourceOf = (node) => appSource.slice(node.start, node.end)
const calls = (node, name) =>
  collect(node, (n) => n.type === 'CallExpression' && n.callee?.name === name)

function trackOrderButton() {
  const buttons = collect(app, (node) =>
    node.type === 'JSXOpeningElement' &&
    node.name?.name === 'button' &&
    node.attributes.some((a) => a.name?.name === 'className' && sourceOf(a).includes('header-track')),
  )
  assert.equal(buttons.length, 1, 'exactly one header Track order button')
  return buttons[0]
}

function showOrderTracking() {
  const [fn] = collect(app, (n) => n.type === 'FunctionDeclaration' && n.id?.name === 'showOrderTracking')
  assert.ok(fn, 'showOrderTracking exists')
  return fn
}

test('the header Track order button uses the shared showOrderTracking handler', () => {
  const onClick = trackOrderButton().attributes.find((a) => a.name?.name === 'onClick')
  assert.equal(sourceOf(onClick.value.expression), 'showOrderTracking')
})

test('Track order refreshes the tracked order when tracking is already open, otherwise opens it', () => {
  const fn = showOrderTracking()
  const [branch] = collect(fn, (n) => n.type === 'IfStatement')
  assert.equal(sourceOf(branch.test), "studentView === 'tracking'")
  assert.equal(calls(branch.consequent, 'refreshTrackedOrder').length, 1, 'refresh when already tracking')
  const opened = calls(branch.alternate, 'setStudentView')
  assert.equal(opened.length, 1)
  assert.equal(sourceOf(opened[0].arguments[0]), "'tracking'")
  assert.equal(calls(fn, 'setIsCartOpen').map((c) => sourceOf(c.arguments[0])).join(), 'false')
  assert.equal(calls(fn, 'setTrackingFocusRequest').length, 1, 'every click requests focus')
})

test('every Track order click scrolls the tracking heading back into view', () => {
  const effects = calls(app, 'useEffect').filter((c) => sourceOf(c.arguments[0]).includes('window.scrollTo(0, 0)'))
  assert.equal(effects.length, 1)
  const deps = effects[0].arguments[1].elements.map((e) => e.name)
  for (const dep of ['activeView', 'studentView', 'trackingFocusRequest']) assert.ok(deps.includes(dep), dep)
  // The tracking view is the first content under the sticky top bar, so the
  // window scroll position 0 shows its heading.
  assert.match(appSource, /studentView === 'tracking' \? \(\s*trackedOrder \? \(\s*<OrderTracking/)
  assert.match(read('src/components/OrderTracking.jsx'), /<main className="tracking-main"[^>]*>\s*<section className=\{`tracking-hero[\s\S]*?<h1 id="tracking-title">/)
})

test('tracked-order polling stays at 3 seconds and only runs on the tracking view', () => {
  assert.match(read('src/hooks/useTrackedOrder.js'), /const TRACKING_POLL_INTERVAL_MS = 3000\b/)
  assert.match(appSource, /useTrackedOrder\(\s*trackedOrderId,\s*user\.role === 'STUDENT' &&\s*activeView === 'student' &&\s*studentView === 'tracking',\s*\)/)
})

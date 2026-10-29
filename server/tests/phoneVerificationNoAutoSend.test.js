import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

// Regression guard: loading or refreshing the mandatory phone-verification
// screen must never request (and pay for) a WhatsApp OTP by itself.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const parseSource = (relativePath) =>
  parse(readFileSync(path.join(projectRoot, relativePath), 'utf8'), {
    sourceType: 'module',
    plugins: ['jsx'],
  })

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

const dialogElements = () =>
  collect(
    parseSource('src/App.jsx'),
    (node) => node.type === 'JSXOpeningElement' && node.name?.name === 'PhoneVerificationDialog',
  )
const attributeNames = (element) =>
  element.attributes.filter((a) => a.type === 'JSXAttribute').map((a) => a.name.name)

test('the app never opens phone verification with automatic code sending', () => {
  const elements = dialogElements()
  assert.ok(elements.length > 0, 'PhoneVerificationDialog is still rendered by App.jsx')
  for (const element of elements) {
    assert.ok(!attributeNames(element).includes('autoRequest'), 'autoRequest must not be passed')
  }
})

test('the mandatory registration gate still renders the verification dialog', () => {
  const mandatory = dialogElements().filter((element) => attributeNames(element).includes('mandatory'))
  assert.equal(mandatory.length, 1, 'exactly one mandatory verification dialog')
  const source = readFileSync(path.join(projectRoot, 'src/App.jsx'), 'utf8')
  assert.match(source, /if \(step === 'verification'\) \{\s*return \(\s*<PhoneVerificationDialog/)
})

test('the dialog defaults to manual sending and keeps the send button', () => {
  const dialog = parseSource('src/components/PhoneVerificationDialog.jsx')
  const [component] = collect(
    dialog,
    (node) => node.type === 'FunctionDeclaration' && node.id?.name === 'PhoneVerificationDialog',
  )
  const props = component.params[0].properties
  const autoRequest = props.find((p) => p.key?.name === 'autoRequest')
  assert.equal(autoRequest?.value?.right?.value, false, 'autoRequest defaults to false')
  const source = readFileSync(path.join(projectRoot, 'src/components/PhoneVerificationDialog.jsx'), 'utf8')
  assert.match(source, /onClick=\{requestCode\}[\s\S]*Send verification code/)
})

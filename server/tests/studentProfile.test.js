import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { initializeDatabase, SCHEMA_VERSION } from '../db.js'
import { resolveGoogleStudent } from '../services/googleAuth.js'
import { getSafeUserById, createSession, resolveSession } from '../services/auth.js'
import { updateStudentPhone } from '../services/phoneProfile.js'
import { requireStudentPhoneVerified } from '../services/authorization.js'
import { registrationStep } from '../../src/auth/registrationStep.js'

const identity = { subject: 'profile-google', email: 'profile@example.test', displayName: 'Profile Student', pictureUrl: null }
const details = { course: '  B.Sc. Computer Science  ', studentClass: '  Year 1   A ', phoneNumber: '9000000061' }

test('schema 8 migration preserves legacy students, staff, sessions and verified access across reopen', t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'campusbite-profile-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const file = path.join(folder, 'synthetic.db')
  let db = initializeDatabase(file)
  db.exec(`ALTER TABLE users DROP COLUMN course;
    ALTER TABLE users DROP COLUMN student_class;
    ALTER TABLE users DROP COLUMN student_profile_required;
    PRAGMA user_version = 8;`)
  db.prepare(`INSERT INTO users (public_id,role,display_name,email,phone_number,phone_verified,status)
    VALUES ('legacy','STUDENT','Legacy Student','profile@example.test','+919000000061',1,'ACTIVE')`).run()
  db.prepare("INSERT INTO auth_identities (user_id,provider,provider_subject) VALUES (1,'GOOGLE','profile-google')").run()
  for (const role of ['OWNER', 'KITCHEN']) db.prepare('INSERT INTO users (public_id,role,display_name,status) VALUES (?,?,?,?)').run(role, role, role, 'ACTIVE')
  const settings = { cookieName: 'test_session', cookieSecure: true, sessionTtlHours: 1, sessionTouchMinutes: 15 }
  const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } }
  const session = createSession(db, 1, request, settings)
  request.headers.cookie = `test_session=${session.rawToken}`
  db.close()
  db = initializeDatabase(file)
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    const student = resolveSession(db, request, settings).user
    assert.equal(student.course, null)
    assert.equal(student.profileDetailsMissing, true)
    assert.equal(student.profileDetailsRequired, false)
    assert.equal(student.displayName, 'Legacy Student')
    assert.equal(student.phoneVerified, true)
    assert.equal(registrationStep(student), 'workspace')
    assert.doesNotThrow(() => requireStudentPhoneVerified({ user: student }))
    assert.equal(resolveGoogleStudent(db, identity).user.profileDetailsRequired, false)
    for (const row of db.prepare("SELECT id FROM users WHERE role != 'STUDENT'").all()) {
      const staff = getSafeUserById(db, row.id)
      assert.equal(registrationStep(staff), 'workspace')
      assert.equal(staff.profileDetailsRequired, false)
    }
    const saved = updateStudentPhone(db, 1, details)
    assert.equal(saved.phoneVerified, true)
    assert.equal(saved.course, 'B.Sc. Computer Science')
    assert.equal(saved.studentClass, 'Year 1 A')
  } finally { db.close() }
  db = initializeDatabase(file)
  try {
    const student = getSafeUserById(db, 1)
    assert.equal(student.course, 'B.Sc. Computer Science')
    assert.equal(student.studentClass, 'Year 1 A')
    assert.equal(student.phoneVerified, true)
  } finally { db.close() }
})

test('new Google registration requires details server-side and persists them through login and sessions', () => {
  const db = initializeDatabase(':memory:')
  try {
    const { internalUserId, user } = resolveGoogleStudent(db, identity)
    assert.equal(user.profileDetailsRequired, true)
    assert.equal(registrationStep(user), 'phone')
    assert.throws(() => updateStudentPhone(db, internalUserId, { phoneNumber: details.phoneNumber, profileDetailsRequired: false }), { code: 'invalid_request' })
    for (const invalid of [undefined, '', '   ', 'x'.repeat(81), 123, 'A\nB']) {
      for (const field of ['course', 'studentClass']) {
        assert.throws(() => updateStudentPhone(db, internalUserId, { ...details, [field]: invalid }), { code: 'invalid_request' })
      }
    }
    assert.equal(getSafeUserById(db, internalUserId).phoneNumber, null)
    const saved = updateStudentPhone(db, internalUserId, { ...details, phoneVerified: true })
    assert.equal(saved.course, 'B.Sc. Computer Science')
    assert.equal(saved.studentClass, 'Year 1 A')
    assert.equal(saved.displayName, identity.displayName)
    assert.equal(saved.googleLinked, true)
    assert.equal(saved.phoneVerified, false)
    assert.equal(saved.profileDetailsRequired, false)
    assert.equal(registrationStep(saved), 'verification')
    assert.throws(() => requireStudentPhoneVerified({ user: saved }), { code: 'phone_verification_required' })
    const returning = resolveGoogleStudent(db, identity)
    assert.equal(returning.created, false)
    assert.equal(returning.user.course, saved.course)
    assert.equal(registrationStep(returning.user), 'verification')
    db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(internalUserId)
    assert.equal(registrationStep(resolveGoogleStudent(db, identity).user), 'workspace')
    const settings = { cookieName: 'profile_session', cookieSecure: false, sessionTtlHours: 1, sessionTouchMinutes: 15 }
    const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } }
    const session = createSession(db, internalUserId, request, settings)
    request.headers.cookie = `profile_session=${session.rawToken}`
    const refreshed = resolveSession(db, request, settings).user
    assert.equal(refreshed.studentClass, saved.studentClass)
    assert.equal(registrationStep(refreshed), 'workspace')
    const updated = updateStudentPhone(db, internalUserId, { phoneNumber: details.phoneNumber, course: 'BSc Mathematics' })
    assert.equal(updated.phoneVerified, true)
    const changed = updateStudentPhone(db, internalUserId, { phoneNumber: '9000000062' })
    assert.equal(changed.phoneVerified, false)
    assert.equal(changed.course, 'BSc Mathematics')
    assert.equal(changed.studentClass, 'Year 1 A')
    assert.throws(() => requireStudentPhoneVerified({ user: changed }), { code: 'phone_verification_required' })
  } finally { db.close() }
})

test('legacy users can keep old phone-only update behavior; staff cannot use student details service', () => {
  const db = initializeDatabase(':memory:')
  try {
    db.prepare("INSERT INTO users (public_id,role,display_name,status) VALUES ('legacy','STUDENT','Legacy','ACTIVE')").run()
    const legacy = updateStudentPhone(db, 1, { phoneNumber: details.phoneNumber })
    assert.equal(legacy.profileDetailsRequired, false)
    assert.equal(legacy.course, null)
    assert.equal(registrationStep(legacy), 'verification')
    for (const role of ['OWNER', 'KITCHEN']) {
      const row = db.prepare('INSERT INTO users (public_id,role,display_name,status) VALUES (?,?,?,?)').run(role, role, role, 'ACTIVE')
      assert.throws(() => updateStudentPhone(db, Number(row.lastInsertRowid), details), { code: 'invalid_request' })
    }
  } finally { db.close() }
})

test('details gate cannot be bypassed by a prefilled phone or client verification flags', () => {
  const db = initializeDatabase(':memory:')
  try {
    const { internalUserId } = resolveGoogleStudent(db, identity)
    // Simulate an incomplete imported record; the server-derived details gate wins.
    db.prepare('UPDATE users SET phone_number = ?, phone_verified = 1 WHERE id = ?').run('+919000000061', internalUserId)
    const student = getSafeUserById(db, internalUserId)
    assert.equal(registrationStep(student), 'phone')
    assert.throws(() => requireStudentPhoneVerified({ user: student }), { code: 'phone_onboarding_required' })
  } finally { db.close() }
})

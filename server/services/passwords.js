import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { invalidRequest } from './apiError.js'

const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const MAX_MEMORY = 64 * 1024 * 1024

export function validatePassword(password, label = 'password') {
  if (typeof password !== 'string') {
    throw invalidRequest(`${label} must be a string.`)
  }

  if (password.length < 12 || password.length > 128) {
    throw invalidRequest(`${label} must contain between 12 and 128 characters.`)
  }

  return password
}

export function hashPassword(password) {
  validatePassword(password)
  const salt = randomBytes(SALT_LENGTH)
  const derivedKey = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEMORY,
  })

  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$')
}

export function verifyPassword(password, encodedHash) {
  if (typeof password !== 'string' || password.length > 128) return false
  if (typeof encodedHash !== 'string') return false

  const [algorithm, nValue, rValue, pValue, saltValue, hashValue, extra] =
    encodedHash.split('$')
  const n = Number(nValue)
  const r = Number(rValue)
  const p = Number(pValue)

  if (
    algorithm !== 'scrypt' ||
    extra !== undefined ||
    n !== SCRYPT_N ||
    r !== SCRYPT_R ||
    p !== SCRYPT_P ||
    !saltValue ||
    !hashValue
  ) {
    return false
  }

  try {
    const expectedHash = Buffer.from(hashValue, 'base64url')
    if (expectedHash.length !== KEY_LENGTH) return false

    const actualHash = scryptSync(
      password,
      Buffer.from(saltValue, 'base64url'),
      expectedHash.length,
      { N: n, r, p, maxmem: MAX_MEMORY },
    )

    return timingSafeEqual(actualHash, expectedHash)
  } catch {
    return false
  }
}

export const PASSWORD_HASH_DESCRIPTION = Object.freeze({
  algorithm: 'scrypt',
  keyLength: KEY_LENGTH,
  n: SCRYPT_N,
  p: SCRYPT_P,
  r: SCRYPT_R,
  saltLength: SALT_LENGTH,
})

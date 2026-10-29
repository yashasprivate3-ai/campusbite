import { createHash } from 'node:crypto'
import { ApiError } from './apiError.js'

function createKey(request, identifier) {
  const ip = String(request.socket.remoteAddress || 'unknown')
  const normalizedIdentifier =
    typeof identifier === 'string' ? identifier.trim().toLowerCase() : 'invalid'
  return createHash('sha256')
    .update(`${ip}|${normalizedIdentifier}`)
    .digest('hex')
}

export class LoginThrottle {
  constructor({ maxAttempts, windowMinutes }) {
    this.attempts = new Map()
    this.maxAttempts = maxAttempts
    this.windowMilliseconds = windowMinutes * 60 * 1000
  }

  assertAllowed(request, identifier) {
    const key = createKey(request, identifier)
    const now = Date.now()
    const entry = this.attempts.get(key)

    if (!entry || now - entry.startedAt >= this.windowMilliseconds) {
      this.attempts.delete(key)
      return key
    }

    if (entry.count >= this.maxAttempts) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          (this.windowMilliseconds - (now - entry.startedAt)) / 1000,
        ),
      )
      throw new ApiError(
        429,
        'too_many_login_attempts',
        'Too many login attempts. Wait before trying again.',
        { retryAfterSeconds },
      )
    }

    return key
  }

  recordFailure(key) {
    const now = Date.now()
    const entry = this.attempts.get(key)

    if (!entry || now - entry.startedAt >= this.windowMilliseconds) {
      this.attempts.set(key, { count: 1, startedAt: now })
    } else {
      entry.count += 1
    }

    if (this.attempts.size > 1000) {
      for (const [candidateKey, candidate] of this.attempts) {
        if (now - candidate.startedAt >= this.windowMilliseconds) {
          this.attempts.delete(candidateKey)
        }
      }
    }
  }

  reset(key) {
    this.attempts.delete(key)
  }
}

export function addFailedLoginDelay() {
  return new Promise((resolve) => setTimeout(resolve, 250))
}

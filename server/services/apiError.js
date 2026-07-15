export class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function invalidRequest(message, details) {
  return new ApiError(400, 'invalid_request', message, details)
}

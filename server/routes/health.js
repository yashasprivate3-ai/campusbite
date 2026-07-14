import { sendJson } from '../services/http.js'

export function handleHealthCheck(response) {
  sendJson(response, 200, {
    status: 'ok',
    service: 'campusbite-api',
  })
}

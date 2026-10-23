// Railway's current status site serves HTML, not the former Statuspage JSON API.
// Check reachability only. No parsing or status wording can authorize deployment.
try {
  const response = await fetch('https://status.railway.com/', { signal: AbortSignal.timeout(15000) })
  if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) throw new Error()
  const page = await response.text()
  if (!page.includes('Railway Status')) throw new Error()
  console.log('Railway public status page reachable. Read it for incident updates; workspace eligibility remains a separate required gate.')
} catch {
  console.error('Railway public status check unavailable. Inspect the workspace privately; no deployment is authorized.')
  process.exitCode = 1
}

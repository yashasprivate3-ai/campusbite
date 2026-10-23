const response = await fetch('https://status.railway.com/api/v2/summary.json', { signal: AbortSignal.timeout(15000) })
if (!response.ok) throw new Error('Railway public status unavailable; inspect the workspace separately.')
const status = await response.json()
console.log(`Railway public status: ${status.status?.indicator || 'unknown'}. Workspace eligibility is a separate required gate.`)

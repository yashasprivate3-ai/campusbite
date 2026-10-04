// Evaluated by Vercel before the build; this value is never a VITE_* secret.
const demoMode = process.env.VITE_DEMO_MODE === 'true'
const backendUrl = String(process.env.CAMPUSBITE_BACKEND_URL || '').trim()
let backendOrigin

if (!demoMode) {
  let parsed
  try {
    parsed = new URL(backendUrl)
  } catch {
    throw new Error('CAMPUSBITE_BACKEND_URL must be the HTTPS Railway backend origin.')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('CAMPUSBITE_BACKEND_URL must be an HTTPS origin without credentials, path, query or fragment.')
  }
  backendOrigin = parsed.origin
}

export const config = {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  // Preserve /api at the backend, including nested routes. No browser redirect.
  rewrites: demoMode ? [] : [
    { source: '/api/:path*', destination: `${backendOrigin}/api/:path*` },
  ],
  headers: demoMode ? [] : [
    {
      source: '/api/:path*',
      headers: [
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'CDN-Cache-Control', value: 'no-store' },
        { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
      ],
    },
  ],
}

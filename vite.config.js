import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { publicPageRoutes } from './shared/publicPages.js'

function installPublicPages(server) {
  server.middlewares.use((request, _response, next) => {
    const url = new URL(request.url, 'http://localhost')
    const route = publicPageRoutes.find(page => page.source === url.pathname.replace(/\/$/, ''))
    if (route) request.url = route.destination + url.search
    next()
  })
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', '')
  const apiHost = environment.CAMPUSBITE_API_HOST || '127.0.0.1'
  const apiPort = environment.CAMPUSBITE_API_PORT || '3001'

  return {
    plugins: [react(), { name: 'public-policy-pages', configureServer: installPublicPages, configurePreviewServer: installPublicPages }],
    server: {
      proxy: {
        '/api': {
          target: `http://${apiHost}:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})

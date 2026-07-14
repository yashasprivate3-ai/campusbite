import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', '')
  const apiHost = environment.CAMPUSBITE_API_HOST || '127.0.0.1'
  const apiPort = environment.CAMPUSBITE_API_PORT || '3001'

  return {
    plugins: [react()],
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

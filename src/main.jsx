import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './auth/AuthContext.jsx'

// This entry-point-only lazy component keeps demo CSS out of the live app bundle.
// eslint-disable-next-line react-refresh/only-export-components
const PublicDemo = lazy(() => import('./components/PublicDemo.jsx').then(
  ({ PublicDemo: Demo }) => ({ default: Demo }),
))

const publicDemo = import.meta.env.VITE_DEMO_MODE === 'true'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {publicDemo ? (
      <Suspense fallback={null}>
        <PublicDemo />
      </Suspense>
    ) : (
      <AuthProvider><App /></AuthProvider>
    )}
  </StrictMode>,
)

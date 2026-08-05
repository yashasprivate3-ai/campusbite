import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './auth/AuthContext.jsx'
import { PublicDemo } from './components/PublicDemo.jsx'

const publicDemo = import.meta.env.VITE_DEMO_MODE === 'true'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {publicDemo ? <PublicDemo /> : <AuthProvider><App /></AuthProvider>}
  </StrictMode>,
)

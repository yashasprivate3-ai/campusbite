import { lazy, Suspense, useState } from 'react'
import { DemoLogin } from './demo/DemoLogin.jsx'
import './PublicDemo.css'
import './DemoFeatures.css'
import './DemoAccessibility.css'

const DemoStudent = lazy(() => import('./demo/DemoStudent.jsx'))
const DemoKitchen = lazy(() => import('./demo/DemoKitchen.jsx'))
const DemoOwner = lazy(() => import('./demo/DemoOwner.jsx'))

const labels = { STUDENT: 'Student', KITCHEN: 'Kitchen', OWNER: 'Owner' }

export function PublicDemo() {
  const [role, setRole] = useState(null)
  const [notice, setNotice] = useState('')

  if (!role) return <DemoLogin onLogin={setRole} />

  return <div className="public-demo">
    <header className="demo-header">
      <button className="demo-brand" onClick={() => setRole('STUDENT')} type="button"><span>CB</span><div><strong>CampusBite</strong><small>Interactive Demo Mode</small></div></button>
      <nav aria-label="Demo role navigation">
        {Object.entries(labels).map(([id, label]) => <button className={role === id ? 'active' : ''} key={id} onClick={() => { setRole(id); setNotice('') }} type="button">{label}</button>)}
        <button onClick={() => setRole(null)} type="button">Exit demo</button>
      </nav>
    </header>
    <div className="demo-notice"><strong>Demo Mode</strong> · Everything is simulated locally. No backend, credentials or real payments are used.</div>
    {notice ? <div className="toast" role="status">✓ {notice}</div> : null}
    <Suspense fallback={<div className="demo-loading">Opening {labels[role]} demo…</div>}>
      {role === 'STUDENT' ? <DemoStudent notify={setNotice} /> : null}
      {role === 'KITCHEN' ? <DemoKitchen notify={setNotice} /> : null}
      {role === 'OWNER' ? <DemoOwner /> : null}
    </Suspense>
  </div>
}

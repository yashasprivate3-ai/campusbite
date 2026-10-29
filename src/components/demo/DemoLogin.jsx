import { useState } from 'react'

const DEMO_OTP = '482731'

export function DemoLogin({ onLogin }) {
  const [step, setStep] = useState('roles')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  function verify(event) {
    event.preventDefault()
    if (code === DEMO_OTP) onLogin('STUDENT')
    else setError('Enter the displayed six-digit demo code.')
  }

  return <main className="demo-login-shell">
    <section className="demo-login-panel">
      <span className="login-logo">CB</span><span className="demo-pill">Demo Mode</span>
      {step === 'roles' ? <><p className="eyebrow">Welcome to CampusBite</p><h1>Choose your demo experience</h1><p>Explore the complete campus ordering journey. No password, backend or real credentials are required.</p>
        <div className="role-grid"><button onClick={() => setStep('otp')} type="button"><span>🎓</span><strong>Student Login</strong><small>Order, pay and track</small></button><button onClick={() => onLogin('KITCHEN')} type="button"><span>👨‍🍳</span><strong>Kitchen Login</strong><small>Queue and batches</small></button><button onClick={() => onLogin('OWNER')} type="button"><span>📊</span><strong>Owner Login</strong><small>Analytics and revenue</small></button></div>
        <div className="divider"><span>or</span></div><button className="google-demo" onClick={() => onLogin('STUDENT')} type="button"><b>G</b> Continue with Google <small>instant demo</small></button>
      </> : <><button className="back-link" onClick={() => setStep('roles')} type="button">← Back</button><p className="eyebrow">WhatsApp verification</p><h1>Verify your phone</h1><p>A six-digit code was sent to your demo WhatsApp number ending in 3210.</p>
        <div className="whatsapp-phone"><div className="whatsapp-head">● CampusBite Business</div><div className="whatsapp-message"><span className="typing">•••</span><p><strong>{DEMO_OTP}</strong> is your verification code.</p><small>For your security, do not share this code. · now ✓✓</small></div></div>
        <div className="otp-sent">✓ WhatsApp verification code sent.</div><form onSubmit={verify}><label>Six-digit code<input autoFocus inputMode="numeric" maxLength="6" onChange={(event) => { setCode(event.target.value.replace(/\D/g, '')); setError('') }} placeholder="000000" value={code} /></label>{error ? <p className="demo-error">{error}</p> : null}<button className="primary-demo-action" type="submit">Verify and enter CampusBite</button></form>
      </>}
      <small className="privacy-note">Interactive frontend simulation · no API calls · no personal data collected</small>
    </section>
  </main>
}

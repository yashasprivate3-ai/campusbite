const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('>>> [1/4] Restoring clean src/App.jsx baseline...');
try {
  execSync('git checkout 7e2b2a3 -- src/App.jsx', { stdio: 'inherit' });
  console.log('    [OK] Restored pristine src/App.jsx');
} catch (e) {
  console.log('    [WARN] git checkout note:', e.message);
}

console.log('>>> [2/4] Exposing direct session control in src/auth/AuthContext.jsx...');
const authPath = path.join('src', 'auth', 'AuthContext.jsx');
if (fs.existsSync(authPath)) {
  let auth = fs.readFileSync(authPath, 'utf8');

  if (!auth.includes('setUser,') && auth.includes('const value = {')) {
    auth = auth.replace('const value = {', 'const value = {\n    setUser,');
  }

  if (!auth.includes('campusbite-user')) {
    auth = auth.replace(
      /useEffect\(\(\) => \{/,
      `useEffect(() => {
    const cached = typeof window !== 'undefined' ? localStorage.getItem('campusbite-user') : null;
    if (cached) {
      try {
        const u = JSON.parse(cached);
        if (u && u.role) { setUser(u); setIsLoading(false); return; }
      } catch(e) {}
    }`
    );
  }

  fs.writeFileSync(authPath, auth, 'utf8');
  console.log('    [OK] Updated AuthContext.jsx');
}

console.log('>>> [3/4] Wiring 1-Tap buttons directly to React state in LoginScreen.jsx...');
const loginPath = path.join('src', 'components', 'LoginScreen.jsx');
if (fs.existsSync(loginPath)) {
  let login = fs.readFileSync(loginPath, 'utf8');

  if (!login.includes('setUser')) {
    login = login.replace(/const \{([\s\S]*?)\} = useAuth\(\)/, 'const { setUser, $1} = useAuth()');
  }

  const pilotCard = `
        <div data-pilot-card="true" style={{ marginBottom: '1.25rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '0.75rem', textAlign: 'center' }}>
          <div style={{ fontWeight: '700', color: '#166534', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            ? 1-TAP PILOT ACCESS (ZERO LOGIN REQUIRED)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => {
                const u = { id: 1, public_id: 'usr_pilot_yashas', role: 'STUDENT', displayName: 'Yashas', email: 'yash97.personal@gmail.com', phone_verified: 1, phoneVerified: true, status: 'ACTIVE' };
                try { localStorage.setItem('campusbite-user', JSON.stringify(u)); } catch(e){}
                if (setUser) setUser(u);
              }}
              style={{ padding: '0.75rem 1rem', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
            >
              ?? 1-Tap Student Login (Yashas)
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={() => {
                  const u = { id: 2, public_id: 'usr_pilot_kitchen', role: 'KITCHEN', displayName: 'Kitchen Lead', status: 'ACTIVE' };
                  try { localStorage.setItem('campusbite-user', JSON.stringify(u)); } catch(e){}
                  if (setUser) setUser(u);
                }}
                style={{ padding: '0.55rem', background: '#ea580c', color: '#ffffff', border: 'none', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                ????? Kitchen Queue
              </button>
              <button
                type="button"
                onClick={() => {
                  const u = { id: 3, public_id: 'usr_pilot_owner', role: 'OWNER', displayName: 'Yashas (Owner)', status: 'ACTIVE' };
                  try { localStorage.setItem('campusbite-user', JSON.stringify(u)); } catch(e){}
                  if (setUser) setUser(u);
                }}
                style={{ padding: '0.55rem', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                ?? Owner Portal
              </button>
            </div>
          </div>
        </div>
  `;

  if (login.includes('data-pilot-buttons="true"') || login.includes('data-pilot-card="true"')) {
    login = login.replace(/<div data-pilot-[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, pilotCard.trim());
  } else if (login.includes('<form')) {
    login = login.replace(/(<form[^>]*>)/, `$1\n${pilotCard}`);
  }

  fs.writeFileSync(loginPath, login, 'utf8');
  console.log('    [OK] Injected direct setUser pilot buttons into LoginScreen.jsx');
}

console.log('>>> [4/4] Code preparation complete.');

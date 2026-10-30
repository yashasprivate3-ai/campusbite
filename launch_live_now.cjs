const fs = require('fs');
const path = require('path');

console.log('>>> [1/2] Unlocking AuthContext.jsx with Instant Pilot State...');
const authPath = path.join('src', 'auth', 'AuthContext.jsx');
if (fs.existsSync(authPath)) {
  let auth = fs.readFileSync(authPath, 'utf8');

  const pilotUser = {
    id: 1,
    public_id: 'usr_pilot_yashas',
    role: 'STUDENT',
    displayName: 'Yashas',
    email: 'yash97.personal@gmail.com',
    phone_verified: 1,
    phoneVerified: true,
    status: 'ACTIVE'
  };

  const userJson = JSON.stringify(pilotUser);

  auth = auth.replace(/useState\(\s*null\s*\)/, `useState(${userJson})`);
  auth = auth.replace(/useState\(\s*true\s*\)/, 'useState(false)');
  auth = auth.replace(/apiClient\.get\(\s*['"]\/api\/auth\/me['"]\s*\)/g, `Promise.resolve({ user: ${userJson} })`);

  if (!auth.includes('window.__setRole')) {
    auth = auth.replace(/(export function AuthProvider[\s\S]*?\{)/, `$1
  useEffect(() => {
    window.__setRole = (role) => {
      setUser(prev => ({ ...prev, role }));
    };
  }, []);`);
  }

  fs.writeFileSync(authPath, auth, 'utf8');
  console.log('    [OK] AuthContext.jsx permanently unlocked into Pilot State');
}

console.log('>>> [2/2] Adding Floating Role Switcher Pill to src/App.jsx...');
const appPath = path.join('src', 'App.jsx');
if (fs.existsSync(appPath)) {
  let app = fs.readFileSync(appPath, 'utf8');

  if (!app.includes('id="pilot-role-switcher"')) {
    const floatingToolbar = `
      <div id="pilot-role-switcher" style={{ position: 'fixed', bottom: '16px', right: '16px', zIndex: 999999, background: '#0f172a', border: '1px solid #334155', padding: '6px 14px', borderRadius: '30px', display: 'flex', gap: '8px', alignItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.4)', fontSize: '12px' }}>
        <span style={{ color: '#4ade80', fontWeight: 'bold' }}>? LIVE PILOT</span>
        <button type="button" onClick={() => window.__setRole && window.__setRole('STUDENT')} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '14px', padding: '4px 10px', fontWeight: 'bold', cursor: 'pointer' }}>Student</button>
        <button type="button" onClick={() => window.__setRole && window.__setRole('KITCHEN')} style={{ background: '#ea580c', color: '#fff', border: 'none', borderRadius: '14px', padding: '4px 10px', fontWeight: 'bold', cursor: 'pointer' }}>Kitchen</button>
        <button type="button" onClick={() => window.__setRole && window.__setRole('OWNER')} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '14px', padding: '4px 10px', fontWeight: 'bold', cursor: 'pointer' }}>Owner</button>
      </div>
    `;

    app = app.replace(/(return\s*\(\s*<div[^>]*>)/, `$1\n${floatingToolbar}`);
    fs.writeFileSync(appPath, app, 'utf8');
    console.log('    [OK] Added floating role switcher to src/App.jsx');
  }
}

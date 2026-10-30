const fs = require('fs');
const path = require('path');

// 1. Inject instant pilotLogin into AuthContext.jsx
const authPath = path.join('src', 'auth', 'AuthContext.jsx');
if (fs.existsSync(authPath)) {
  let auth = fs.readFileSync(authPath, 'utf8');
  if (!auth.includes('pilotLogin')) {
    const helperCode = `
  const pilotLogin = (role = 'STUDENT') => {
    const pilotUser = {
      id: role === 'STUDENT' ? 1 : role === 'KITCHEN' ? 2 : 3,
      public_id: 'usr_pilot_' + role.toLowerCase(),
      role: role,
      displayName: role === 'STUDENT' ? 'Yashas' : role === 'KITCHEN' ? 'Kitchen Lead' : 'Yashas (Owner)',
      email: role === 'STUDENT' ? 'yash97.personal@gmail.com' : role.toLowerCase() + '@campusbite.com',
      phone_verified: 1,
      phoneVerified: true,
      status: 'ACTIVE'
    };
    try { localStorage.setItem('campusbite-pilot-user', JSON.stringify(pilotUser)); } catch (e) {}
    setUser(pilotUser);
    setIsLoading(false);
  };
`;
    auth = auth.replace(/(const value = \{)/, helperCode + '\n  $1 pilotLogin,');
    auth = auth.replace(/(useEffect\(\(\) => \{)/, `$1
    const cachedPilot = typeof window !== 'undefined' ? localStorage.getItem('campusbite-pilot-user') : null;
    if (cachedPilot) {
      try {
        const parsed = JSON.parse(cachedPilot);
        if (parsed && parsed.role) {
          setUser(parsed);
          setIsLoading(false);
          return;
        }
      } catch (e) {}
    }`);
    fs.writeFileSync(authPath, auth, 'utf8');
    console.log('[OK] Added pilotLogin directly to AuthContext.jsx');
  }
}

// 2. Connect 1-Tap buttons directly to pilotLogin
const loginPath = path.join('src', 'components', 'LoginScreen.jsx');
if (fs.existsSync(loginPath)) {
  let login = fs.readFileSync(loginPath, 'utf8');
  if (!login.includes('pilotLogin')) {
    login = login.replace(/const \{([\s\S]*?)\} = useAuth\(\)/, 'const { pilotLogin, $1} = useAuth()');
  }
  login = login.replace(
    /onClick=\{\(e\) => \{[\s\S]*??? 1-Tap Student Login \(Yashas\)[\s\S]*?<\/button>/,
    `onClick={() => pilotLogin ? pilotLogin('STUDENT') : null}
              style={{ padding: '0.75rem 1rem', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
            >
              ?? 1-Tap Student Login (Yashas)
            </button>`
  );
  login = login.replace(
    /onClick=\{\(e\) => \{[\s\S]*?????? Kitchen Queue[\s\S]*?<\/button>/,
    `onClick={() => pilotLogin ? pilotLogin('KITCHEN') : null}
                style={{ padding: '0.55rem', background: '#ea580c', color: '#ffffff', border: 'none', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                ????? Kitchen Queue
              </button>`
  );
  login = login.replace(
    /onClick=\{\(e\) => \{[\s\S]*??? Owner Portal[\s\S]*?<\/button>/,
    `onClick={() => pilotLogin ? pilotLogin('OWNER') : null}
                style={{ padding: '0.55rem', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                ?? Owner Portal
              </button>`
  );
  fs.writeFileSync(loginPath, login, 'utf8');
  console.log('[OK] Connected buttons directly to pilotLogin');
}

const fs = require('fs');
const path = require('path');

// 1. Clean src/App.jsx (removes any invalid injections)
const appPath = path.join('src', 'App.jsx');
if (fs.existsSync(appPath)) {
  let app = fs.readFileSync(appPath, 'utf8');
  if (app.includes('pilot-role-switcher')) {
    app = app.replace(/<div id="pilot-role-switcher"[\s\S]*?<\/div>/g, '');
    fs.writeFileSync(appPath, app, 'utf8');
    console.log('[OK] Cleaned src/App.jsx JSX structure');
  }
}

// 2. Set default authenticated Student cleanly in AuthContext.jsx
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
  
  const userStr = JSON.stringify(pilotUser);
  
  auth = auth.replace(/useState\(\s*(?:null|userJson|PILOT_USER)?\s*\)/, `useState(${userStr})`);
  auth = auth.replace(/useState\(\s*true\s*\)/, 'useState(false)');
  auth = auth.replace(/apiClient\.get\(\s*['"]\/api\/auth\/me['"]\s*\)/g, `Promise.resolve({ user: ${userStr} })`);
  
  fs.writeFileSync(authPath, auth, 'utf8');
  console.log('[OK] Set default authenticated Student in AuthContext.jsx');
}

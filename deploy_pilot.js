const fs = require("fs");
const path = require("path");

// 1. Update server/config.js with master dev accounts and password reset
const configPath = path.join("server", "config.js");
if (fs.existsSync(configPath)) {
  let cfg = fs.readFileSync(configPath, "utf8");
  cfg = cfg.replace(/resetDevelopmentPasswords:\s*false/g, "resetDevelopmentPasswords: true");
  const accountsStr = `developmentAccounts: [
    { identifier: "student@campusbite.com", password: "Chefsinstinct.com", role: "STUDENT", displayName: "Yashas (Student)" },
    { identifier: "kitchen@campusbite.com", password: "Chefsinstinct.com", role: "KITCHEN", displayName: "Kitchen Lead" },
    { identifier: "owner@campusbite.com", password: "Chefsinstinct.com", role: "OWNER", displayName: "Yashas (Owner)" }
  ]`;
  cfg = cfg.replace(/developmentAccounts:\s*\[[\s\S]*?\]/, accountsStr);
  fs.writeFileSync(configPath, cfg, "utf8");
  console.log("[OK] Updated server/config.js with Chefsinstinct.com accounts and password reset");
}

// 2. Wire 1-tap buttons in LoginScreen.jsx with Chefsinstinct.com
const loginPath = path.join("src", "components", "LoginScreen.jsx");
if (fs.existsSync(loginPath)) {
  let login = fs.readFileSync(loginPath, "utf8");
  login = login.split("password123").join("Chefsinstinct.com");
  fs.writeFileSync(loginPath, login, "utf8");
  console.log("[OK] Wired 1-tap buttons with Chefsinstinct.com");
}

// 3. Update .env files with safe staging flags
const envContent = "CAMPUSBITE_PUBLIC_APP_URL=https://campus.chefsinstinct.in\nCAMPUSBITE_PAYMENT_PROVIDER=disabled\nCAMPUSBITE_LIVE_PAYMENTS_APPROVED=false\nCAMPUSBITE_OTP_PROVIDER=development\nCAMPUSBITE_DEV_OTP_CODE=123456\n";
fs.writeFileSync(".env", envContent, "utf8");
fs.writeFileSync(".env.production", envContent, "utf8");
console.log("[OK] Configured staging .env and .env.production");

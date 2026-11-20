// Хранилище логина/пароля администратора. При первом запуске создаётся
// из ADMIN_USERNAME/ADMIN_PASSWORD в .env, дальше живёт в admin.json —
// пароль хранится не в открытом виде, а как соль+хэш (scrypt).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_PATH = path.join(__dirname, 'admin.json');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const hash = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

function ensureAdminFile() {
  if (fs.existsSync(FILE_PATH)) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  saveAdmin({ username, passwordHash: hashPassword(password) });
}

function readAccounts() {
  ensureAdminFile();
  return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
}

function saveAdmin(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getAdmin(role = 'admin') {
  const accounts = readAccounts();
  const account = role === 'superadmin' ? accounts.superadmin : accounts;
  return account && { username: account.username };
}

function verifyLogin(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const accounts = readAccounts();
  if (accounts.username === username && verifyPassword(password, accounts.passwordHash)) return 'admin';
  if (accounts.superadmin?.username === username && verifyPassword(password, accounts.superadmin.passwordHash)) {
    return 'superadmin';
  }
  return null;
}

// currentPassword всегда обязателен и проверяется отдельно перед вызовом.
function updateCredentials(role, { username, password }) {
  const accounts = readAccounts();
  const isSuperadmin = role === 'superadmin';
  const account = isSuperadmin ? accounts.superadmin : accounts;
  const otherAccount = isSuperadmin ? accounts : accounts.superadmin;
  const nextUsername = username.trim();
  if (otherAccount?.username === nextUsername) return false;
  account.username = nextUsername;
  if (password) account.passwordHash = hashPassword(password);
  saveAdmin(accounts);
  return true;
}

module.exports = { getAdmin, verifyLogin, updateCredentials };

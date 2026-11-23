// Учётные записи администратора и суперадминистратора. Пароли хранятся
// в виде соли и хэша scrypt.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const database = require('./database');

const FILE_PATH = path.join(__dirname, 'admin.json');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const hash = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

function defaultAdminAccount() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  return { username, passwordHash: hashPassword(password) };
}

function readAccounts() {
  if (!fs.existsSync(FILE_PATH)) saveAdmin(defaultAdminAccount());
  return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
}

function saveAdmin(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getAdminAccountsForImport() {
  const { superadmin, ...admin } = fs.existsSync(FILE_PATH)
    ? JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'))
    : defaultAdminAccount();
  const accounts = [{ id: 'admin', data: admin }];
  if (superadmin) accounts.push({ id: 'superadmin', data: superadmin });
  return accounts;
}

function normalizeRole(role) {
  return role === 'superadmin' ? 'superadmin' : 'admin';
}

function publicAccount(account) {
  return account && { username: account.username };
}

async function getDatabaseAdmin(role) {
  const { rows } = await database.query('SELECT data FROM admin_accounts WHERE id = $1', [role]);
  return publicAccount(rows[0]?.data);
}

function getAdmin(role = 'admin') {
  role = normalizeRole(role);
  if (database.enabled) return getDatabaseAdmin(role);
  const accounts = readAccounts();
  return publicAccount(role === 'superadmin' ? accounts.superadmin : accounts);
}

function verifyAccount(account, username, password) {
  return account?.username === username && verifyPassword(password, account.passwordHash);
}

async function verifyDatabaseLogin(username, password) {
  const { rows } = await database.query(
    "SELECT id, data FROM admin_accounts WHERE data->>'username' = $1 ORDER BY id",
    [username],
  );
  return rows.find(({ data }) => verifyAccount(data, username, password))?.id ?? null;
}

function verifyLogin(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  if (database.enabled) return verifyDatabaseLogin(username, password);
  const accounts = readAccounts();
  if (verifyAccount(accounts, username, password)) return 'admin';
  if (verifyAccount(accounts.superadmin, username, password)) return 'superadmin';
  return null;
}

function applyCredentials(account, otherAccount, { username, password, currentPassword }) {
  if (!account || (currentPassword !== undefined && !verifyPassword(currentPassword, account.passwordHash))) {
    return 'invalid-current-password';
  }
  const nextUsername = username.trim();
  if (otherAccount?.username === nextUsername) return false;
  account.username = nextUsername;
  if (password) account.passwordHash = hashPassword(password);
  return true;
}

function updateDatabaseCredentials(role, credentials) {
  return database.transaction(async (client) => {
    // Обе строки блокируются в одном порядке. Второе изменение видит
    // новый хэш пароля и новое имя после первого сохранения.
    const { rows } = await client.query('SELECT id, data FROM admin_accounts ORDER BY id FOR UPDATE');
    const account = rows.find(({ id }) => id === role)?.data;
    const otherAccount = rows.find(({ id }) => id !== role)?.data;
    const updated = applyCredentials(account, otherAccount, credentials);
    if (updated === true) {
      await client.query('UPDATE admin_accounts SET data = $2::jsonb WHERE id = $1', [role, account]);
    }
    return updated;
  });
}

function updateCredentials(role, credentials) {
  role = normalizeRole(role);
  if (database.enabled) return updateDatabaseCredentials(role, credentials);
  const accounts = readAccounts();
  const account = role === 'superadmin' ? accounts.superadmin : accounts;
  const otherAccount = role === 'superadmin' ? accounts : accounts.superadmin;
  const updated = applyCredentials(account, otherAccount, credentials);
  if (updated === true) saveAdmin(accounts);
  return updated;
}

module.exports = { getAdmin, verifyLogin, updateCredentials, getAdminAccountsForImport };

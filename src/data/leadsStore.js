// Хранилище заявок с сайта. JSON используется в локальном режиме без базы.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const database = require('./database');

const FILE_PATH = path.join(__dirname, 'leads.json');

const STATUSES = ['new', 'completed', 'rejected'];

// Файл не должен попадать в git (в нём реальные имена/телефоны/e-mail
// обращений) — поэтому при первом запуске на новой машине его ещё нет,
// и его нужно создать пустым, как admin.json в adminStore.js.
function ensureLeadsFile() {
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, '[]\n', 'utf8');
  }
}

function readLeads() {
  ensureLeadsFile();
  const raw = fs.readFileSync(FILE_PATH, 'utf8');
  return JSON.parse(raw);
}

async function getDatabaseLeads() {
  const { rows } = await database.query('SELECT data FROM leads ORDER BY position DESC, id');
  return rows.map(({ data }) => data);
}

function getLeads() {
  return database.enabled ? getDatabaseLeads() : readLeads();
}

function saveLeads(leads) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(leads, null, 2), 'utf8');
}

function addDatabaseLead(lead) {
  return database.transaction(async (client) => {
    await client.query('LOCK TABLE leads IN SHARE ROW EXCLUSIVE MODE');
    await client.query(
      'INSERT INTO leads (id, data, position) SELECT $1, $2::jsonb, COALESCE(MAX(position), 0) + 1 FROM leads',
      [lead.id, lead],
    );
    return lead;
  });
}

// Новая заявка всегда попадает в список со статусом "new" — по умолчанию.
// Телефон и e-mail оба необязательны по отдельности, но хотя бы одно из
// полей должно быть заполнено — это проверяется до вызова addLead.
// details — необязательное описание контекста заявки (например, конфигурация
// из формы подбора проекта).
function addLead({ name, phone, email, details }) {
  const lead = {
    id: crypto.randomUUID(),
    name,
    phone: phone || '',
    email: email || '',
    details: details || '',
    status: 'new',
    comment: '',
    createdAt: new Date().toISOString(),
  };
  if (database.enabled) return addDatabaseLead(lead);
  const leads = readLeads();
  leads.unshift(lead); // новые обращения — сверху списка
  saveLeads(leads);
  return lead;
}

async function updateDatabaseLead(id, key, value) {
  const { rows } = await database.query(
    'UPDATE leads SET data = jsonb_set(data, ARRAY[$2::text], to_jsonb($3::text)) WHERE id = $1 RETURNING data',
    [id, key, value],
  );
  return rows[0]?.data ?? null;
}

function updateLead(id, key, value) {
  if (database.enabled) return updateDatabaseLead(id, key, value);
  const leads = readLeads();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return null;
  lead[key] = value;
  saveLeads(leads);
  return lead;
}

function updateLeadStatus(id, status) {
  return STATUSES.includes(status) ? updateLead(id, 'status', status) : null;
}

function updateLeadComment(id, comment) {
  return updateLead(id, 'comment', comment);
}

async function deleteDatabaseLead(id) {
  const { rowCount } = await database.query('DELETE FROM leads WHERE id = $1', [id]);
  return rowCount > 0;
}

function deleteLead(id) {
  if (database.enabled) return deleteDatabaseLead(id);
  const leads = readLeads();
  const index = leads.findIndex((l) => l.id === id);
  if (index === -1) return false;
  leads.splice(index, 1);
  saveLeads(leads);
  return true;
}

module.exports = { getLeads, addLead, updateLeadStatus, updateLeadComment, deleteLead, STATUSES };

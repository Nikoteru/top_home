// Хранилище заявок (обращений) с сайта — тоже простой JSON-файл на диске,
// как и content.json. Для одной небольшой админки этого достаточно.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function getLeads() {
  ensureLeadsFile();
  const raw = fs.readFileSync(FILE_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveLeads(leads) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(leads, null, 2), 'utf8');
}

// Новая заявка всегда попадает в список со статусом "new" — по умолчанию.
// Телефон и e-mail оба необязательны по отдельности, но хотя бы одно из
// полей должно быть заполнено — это проверяется до вызова addLead.
function addLead({ name, phone, email }) {
  const leads = getLeads();
  const lead = {
    id: crypto.randomUUID(),
    name,
    phone: phone || '',
    email: email || '',
    status: 'new',
    comment: '',
    createdAt: new Date().toISOString(),
  };
  leads.unshift(lead); // новые обращения — сверху списка
  saveLeads(leads);
  return lead;
}

function updateLeadStatus(id, status) {
  if (!STATUSES.includes(status)) return null;
  const leads = getLeads();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return null;
  lead.status = status;
  saveLeads(leads);
  return lead;
}

function updateLeadComment(id, comment) {
  const leads = getLeads();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return null;
  lead.comment = comment;
  saveLeads(leads);
  return lead;
}

function deleteLead(id) {
  const leads = getLeads();
  const index = leads.findIndex((l) => l.id === id);
  if (index === -1) return false;
  leads.splice(index, 1);
  saveLeads(leads);
  return true;
}

module.exports = { getLeads, addLead, updateLeadStatus, updateLeadComment, deleteLead, STATUSES };

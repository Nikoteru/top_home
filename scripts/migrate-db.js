require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const database = require('../src/data/database');
const { titleKey } = require('../src/data/estimatesStore');
const { getAdminAccountsForImport } = require('../src/data/adminStore');
const defaultUnits = require('../src/data/estimateUnits');

const source = path.join(__dirname, '..', 'src', 'data');

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(source, name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Не удалось прочитать ${name}.`, { cause: error });
  }
}

function records(name, fallback = []) {
  const data = readJson(name, fallback);
  const ids = data.map((item) => item?.id);
  if (ids.some((id) => !['string', 'number'].includes(typeof id) || !String(id).trim()) || new Set(ids.map(String)).size !== ids.length) {
    throw new Error(`В ${name} есть пустые или повторяющиеся идентификаторы.`);
  }
  return data;
}

async function insertCollection(client, table, entries, named = false) {
  const rows = entries.map((data, index) => {
    const row = { id: String(data.id), data, position: entries.length - index };
    if (!named) return row;
    if (typeof data.title !== 'string' || !titleKey(data.title)) throw new Error(`В ${table} есть запись без названия.`);
    return { ...row, title_key: titleKey(data.title), revision: Number.isSafeInteger(data.revision) ? data.revision : 0 };
  });
  // Имена таблиц передаются только из списка коллекций ниже.
  const columns = named ? 'id, data, position, title_key, revision' : 'id, data, position';
  const types = named ? 'id text, data jsonb, position bigint, title_key text, revision bigint' : 'id text, data jsonb, position bigint';
  await client.query(`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM jsonb_to_recordset($1::jsonb) AS items(${types})`, [JSON.stringify(rows)]);
}

async function migrate() {
  const schema = fs.readFileSync(path.join(source, 'postgres-schema.sql'), 'utf8');
  return database.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(925177631)');
    await client.query(schema);
    const initialized = await client.query('SELECT 1 FROM site_content WHERE singleton');
    if (initialized.rowCount) return null;

    const { houses, ...settings } = readJson('content.json');
    if (!Array.isArray(houses)) throw new Error('В content.json нет списка проектов.');
    const templates = records('estimates.json');
    const runs = records('estimate-runs.json');
    const runIds = new Set(runs.map(({ id }) => String(id)));
    if (houses.some(({ estimateRunId }) => estimateRunId && !runIds.has(String(estimateRunId)))) {
      throw new Error('В проектах есть привязки к расчётам, которых нет в estimate-runs.json. Восстановите файл расчётов и повторите перенос.');
    }

    const leads = records('leads.json');
    const collections = [
      ['estimate_templates', templates, true],
      ['estimate_runs', runs, true],
      ['estimate_archive', records('estimate-archive.json')],
      ['estimate_materials', records('estimate-materials.json')],
      ['estimate_units', records('estimate-units.json', defaultUnits.map((unit, index) => ({ ...unit, id: String(index + 1) })))],
      ['leads', leads],
    ];
    for (const [table, entries, named] of collections) await insertCollection(client, table, entries, named);

    const projects = houses.map((data, position) => ({ id: String(data.id), data, position }));
    await client.query(`
      INSERT INTO projects (id, data, position)
      SELECT id, data, position FROM jsonb_to_recordset($1::jsonb) AS items(id text, data jsonb, position bigint)
    `, [JSON.stringify(projects)]);
    const accounts = getAdminAccountsForImport();
    await client.query(`
      INSERT INTO admin_accounts (id, data)
      SELECT id, data FROM jsonb_to_recordset($1::jsonb) AS items(id text, data jsonb)
    `, [JSON.stringify(accounts)]);
    await client.query('INSERT INTO site_content (singleton, data) VALUES (true, $1)', [settings]);
    return { projects: houses.length, templates: templates.length, runs: runs.length, leads: leads.length, accounts: accounts.length };
  });
}

migrate().then((counts) => {
  if (counts) {
    console.log(`Данные перенесены. Проекты ${counts.projects}, шаблоны ${counts.templates}, расчёты ${counts.runs}, заявки ${counts.leads}, учётные записи ${counts.accounts}.`);
  } else {
    console.log('Данные сайта уже импортированы. Повторная загрузка пропущена.');
  }
}).catch((error) => {
  console.error('Перенос прерван.', error.code ? `Ошибка PostgreSQL ${error.code}.` : error.message);
  process.exitCode = 1;
}).finally(() => database.close());

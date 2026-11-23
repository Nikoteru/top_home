const fs = require('fs');
const path = require('path');
const database = require('./database');

const FILE_PATH = path.join(__dirname, 'content.json');
const revisions = new WeakMap();

async function readFromDatabase() {
  const { rows: [row] } = await database.query(`
    SELECT data, revision, (SELECT COALESCE(jsonb_agg(data ORDER BY position, id), '[]'::jsonb) FROM projects) AS houses
    FROM site_content WHERE singleton
  `);
  const content = { ...row.data, houses: row.houses };
  revisions.set(content, row.revision);
  return content;
}

async function writeToDatabase(content) {
  const { houses, ...settings } = content;
  const projects = houses.map((data, position) => ({ id: String(data.id), data, position }));
  const revision = await database.transaction(async (client) => {
    const { rows: [updated] } = await client.query(`
      UPDATE site_content SET data = $1, revision = revision + 1
      WHERE singleton AND revision = $2 RETURNING revision
    `, [settings, revisions.get(content)]);
    if (!updated) {
      const error = new Error('Данные уже изменились. Обновите страницу и повторите сохранение.');
      error.status = 409;
      throw error;
    }

    await client.query('DELETE FROM projects WHERE NOT (id = ANY($1::text[]))', [projects.map(({ id }) => id)]);
    await client.query(`
      INSERT INTO projects (id, data, position)
      SELECT id, data, position FROM jsonb_to_recordset($1::jsonb) AS items(id text, data jsonb, position bigint)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, position = EXCLUDED.position
      WHERE projects.data IS DISTINCT FROM EXCLUDED.data OR projects.position IS DISTINCT FROM EXCLUDED.position
    `, [JSON.stringify(projects)]);
    return updated.revision;
  });
  revisions.set(content, revision);
}

function getContent() {
  if (database.enabled) return readFromDatabase();
  const raw = fs.readFileSync(FILE_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveContent(content) {
  if (database.enabled) return writeToDatabase(content);
  fs.writeFileSync(FILE_PATH, JSON.stringify(content, null, 2), 'utf8');
}

module.exports = { getContent, saveContent };

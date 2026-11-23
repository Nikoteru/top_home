const { randomUUID } = require('node:crypto');

function createPostgresEstimates(database, titleKey) {
  const templates = 'estimate_templates';
  const runs = 'estimate_runs';
  const archive = 'estimate_archive';
  const materials = 'estimate_materials';
  const units = 'estimate_units';

  async function list(table, client = database) {
    const result = await client.query(`SELECT data FROM ${table} ORDER BY position DESC, id`);
    return result.rows.map(({ data }) => data);
  }

  function lockWrites(client, table) {
    return client.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
  }

  function append(client, table, item) {
    return client.query(`
      INSERT INTO ${table} (id, data, position)
      VALUES ($1, $2, (SELECT COALESCE(MIN(position), 0) - 1 FROM ${table}))
    `, [item.id, item]);
  }

  async function saveMaterial(id, values) {
    const material = { ...values, id: id || randomUUID() };
    if (id) {
      const result = await database.query(`UPDATE ${materials} SET data = $2 WHERE id = $1`, [id, material]);
      return result.rowCount !== 0;
    }

    return database.transaction(async (client) => {
      await lockWrites(client, materials);
      await append(client, materials, material);
      return true;
    });
  }

  function saveEstimateUnit(id, values) {
    return database.transaction(async (client) => {
      await lockWrites(client, units);
      const entries = await list(units, client);
      if (id && !entries.some((unit) => unit.id === id)) return 404;
      const key = values.value.toLowerCase();
      if (entries.some((unit) => unit.id !== id && unit.value.toLowerCase() === key)) return 409;

      const unit = { ...values, id: id || randomUUID() };
      if (id) await client.query(`UPDATE ${units} SET data = $2 WHERE id = $1`, [id, unit]);
      else await append(client, units, unit);
      return 200;
    });
  }

  async function archiveLegacyEstimate(client, estimate) {
    if (estimate.isTemplate) return;
    await client.query(`
      INSERT INTO ${archive} (id, data, position)
      VALUES ($1, $2, (SELECT COALESCE(MIN(position), 0) - 1 FROM ${archive}))
      ON CONFLICT (id) DO NOTHING
    `, [estimate.id, estimate]);
  }

  function saveDocument(table, id, revision, values) {
    return database.transaction(async (client) => {
      // Serialize writes so position and revision checks use the same committed state.
      await lockWrites(client, table);
      const existing = id && await client.query(`SELECT data FROM ${table} WHERE id = $1`, [id]);
      const current = existing ? existing.rows[0]?.data : undefined;
      if (id && !current) return { status: 404 };
      if (current && current.revision !== revision) return { status: 409 };

      if (table === runs && !id) {
        const result = await client.query(`SELECT data FROM ${templates} WHERE id = $1 FOR SHARE`, [values.template?.id]);
        const template = result.rows[0]?.data;
        if (!template) return { status: 404, templateMissing: true };
        if (template.revision !== values.template.revision) return { status: 409, templateChanged: true };
      }

      const saved = { ...values, id: id || randomUUID(), revision: (current?.revision || 0) + 1 };
      const name = titleKey(values.title);
      const duplicate = await client.query(`SELECT 1 FROM ${table} WHERE title_key = $1 AND id <> $2`, [name, saved.id]);
      if (duplicate.rowCount) return { status: 409, duplicateTitle: true };

      const record = [saved.id, saved, name, saved.revision];
      if (current) {
        if (table === templates) await archiveLegacyEstimate(client, current);
        await client.query(`UPDATE ${table} SET data = $2, title_key = $3, revision = $4 WHERE id = $1`, record);
      } else {
        await client.query(`
          INSERT INTO ${table} (id, data, title_key, revision, position)
          VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(position), 0) + 1 FROM ${table}))
        `, record);
      }
      return { id: saved.id };
    });
  }

  return {
    getEstimates: () => list(templates),
    saveEstimate: (id, revision, values) => saveDocument(templates, id, revision, values),
    getEstimateRuns: () => list(runs),
    saveEstimateRun: (id, revision, values) => saveDocument(runs, id, revision, values),
    getMaterials: () => list(materials),
    saveMaterial,
    getEstimateUnits: () => list(units),
    saveEstimateUnit,
  };
}

module.exports = { createPostgresEstimates };

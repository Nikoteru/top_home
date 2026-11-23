const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const database = require('./database');
const defaultUnits = require('./estimateUnits');
const { createPostgresEstimates } = require('./postgresEstimates');

function readCollection(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeCollection(file, entries) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function titleKey(title) {
  return title.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('ru-RU');
}

function saveDocument(file, id, revision, values, beforeSave) {
  const estimates = readCollection(file);
  const index = id ? estimates.findIndex((estimate) => estimate.id === id) : -1;
  if (id && index === -1) return { status: 404 };

  const current = estimates[index];
  if (current && current.revision !== revision) return { status: 409 };

  const name = titleKey(values.title);
  if (estimates.some((estimate) => estimate.id !== id && titleKey(estimate.title) === name)) {
    return { status: 409, duplicateTitle: true };
  }

  const saved = { ...values, id: id || randomUUID(), revision: (current?.revision || 0) + 1 };
  if (current && beforeSave) beforeSave(current);
  if (current) estimates[index] = saved;
  else estimates.unshift(saved);

  writeCollection(file, estimates);
  return { id: saved.id };
}

function createFileEstimatesStore(directory) {
  const estimatesFile = path.join(directory, 'estimates.json');
  const runsFile = path.join(directory, 'estimate-runs.json');
  const archiveFile = path.join(directory, 'estimate-archive.json');
  const materialsFile = path.join(directory, 'estimate-materials.json');
  const unitsFile = path.join(directory, 'estimate-units.json');

  function getMaterials() {
    return readCollection(materialsFile);
  }

  function saveMaterial(id, values) {
    const materials = getMaterials();
    const index = materials.findIndex((material) => material.id === id);
    if (id && index === -1) return false;
    const material = { ...values, id: id || randomUUID() };
    if (id) materials[index] = material;
    else materials.push(material);
    writeCollection(materialsFile, materials);
    return true;
  }

  function getEstimateUnits() {
    const defaults = defaultUnits.map((unit, index) => ({ ...unit, id: String(index + 1) }));
    return readCollection(unitsFile, defaults);
  }

  function saveEstimateUnit(id, values) {
    const units = getEstimateUnits();
    const index = units.findIndex((unit) => unit.id === id);
    if (id && index === -1) return 404;
    if (units.some((unit) => unit.id !== id && unit.value.toLowerCase() === values.value.toLowerCase())) return 409;
    const unit = { ...values, id: id || randomUUID() };
    if (id) units[index] = unit;
    else units.push(unit);
    writeCollection(unitsFile, units);
    return 200;
  }

  function archiveLegacyEstimate(estimate) {
    if (estimate.isTemplate) return;
    const archive = readCollection(archiveFile);
    if (archive.some((entry) => entry.id === estimate.id)) return;
    writeCollection(archiveFile, [...archive, estimate]);
  }

  return {
    getEstimates: () => readCollection(estimatesFile),
    saveEstimate: (id, revision, values) => saveDocument(estimatesFile, id, revision, values, archiveLegacyEstimate),
    getEstimateRuns: () => readCollection(runsFile),
    saveEstimateRun: (id, revision, values) => saveDocument(runsFile, id, revision, values),
    getMaterials, saveMaterial, getEstimateUnits, saveEstimateUnit,
  };
}

const store = database.enabled ? createPostgresEstimates(database, titleKey) : createFileEstimatesStore(__dirname);

module.exports = { ...store, createFileEstimatesStore, titleKey };

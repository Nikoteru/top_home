const { normalizeHouseParameters } = require('./houseParameters');

function getAreaLimits(calculator) {
  const min = Number(calculator?.area?.min) || 60;
  const max = Number(calculator?.area?.max) || 400;
  return { min, max };
}

function normalizeProjectFilters(calculator, raw = {}) {
  const limits = getAreaLimits(calculator);
  function bound(value, fallback) {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;
    if (String(value).trim() === '') return fallback;
    const number = Number(String(value).replace(',', '.'));
    return Number.isFinite(number) ? Math.min(limits.max, Math.max(limits.min, Math.round(number))) : fallback;
  }
  const from = bound(raw.areaMin, limits.min);
  const to = bound(raw.areaMax, limits.max);
  return {
    areaMin: Math.min(from, to),
    areaMax: Math.max(from, to),
    selection: normalizeHouseParameters(calculator, raw.selection),
  };
}

function projectArea(value) {
  const match = String(value ?? '').replace(/\s/g, '').match(/[-+]?\d+(?:[.,]\d+)?/);
  const area = match ? Number(match[0].replace(',', '.')) : NaN;
  return Number.isFinite(area) && area > 0 ? area : null;
}

function matchProjects(houses, calculator, raw) {
  const filters = normalizeProjectFilters(calculator, raw);
  // Пустые группы (включая «Дополнительно») совсем не участвуют в подборе.
  const active = Object.entries(filters.selection).filter(([, ids]) => ids.length);
  return houses.filter((house) => {
    const area = projectArea(house.area);
    if (area === null || area < filters.areaMin || area > filters.areaMax) return false;
    const parameters = normalizeHouseParameters(calculator, house.parameters);
    // У проекта могут быть другие опции, но все выбранные должны присутствовать.
    return active.every(([id, ids]) => ids.every((option) => parameters[id].includes(option)));
  });
}

function describeProjectFilters(calculator, raw) {
  const filters = normalizeProjectFilters(calculator, raw);
  const parts = [`Подбор проекта: площадь ${filters.areaMin}–${filters.areaMax} м²`];
  for (const block of calculator.blocks || []) {
    const titles = (block.options || [])
      .filter((option) => filters.selection[block.id].includes(String(option.id)))
      .map((option) => option.title);
    if (titles.length) parts.push(`${block.title}: ${titles.join(', ')}`);
  }
  return parts.join('; ');
}

module.exports = { getAreaLimits, normalizeProjectFilters, projectArea, matchProjects, describeProjectFilters };

// Параметры проекта используют те же блоки и варианты, что и калькулятор.
// Храним id вариантов: переименование в калькуляторе обновит и таблицы домов.
function normalizeHouseParameters(calculator, raw) {
  const submitted = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries((calculator?.blocks || []).map((block) => {
    const value = Object.prototype.hasOwnProperty.call(submitted, block.id) ? submitted[block.id] : [];
    const ids = new Set((Array.isArray(value) ? value : [value])
      .filter((id) => typeof id === 'string' || typeof id === 'number')
      .map(String));
    const selected = (block.options || []).filter((option) => ids.has(String(option.id)));
    return [String(block.id), (block.multiple ? selected : selected.slice(0, 1)).map((option) => String(option.id))];
  }));
}

function getHouseParameterFields(house, calculator) {
  const parameters = normalizeHouseParameters(calculator, house.parameters);
  return (calculator?.blocks || []).map((block) => ({
    id: String(block.id),
    title: block.title,
    multiple: Boolean(block.multiple),
    options: block.options || [],
    selectedIds: parameters[block.id],
  }));
}

function normalizeLabel(label) {
  const value = String(label).trim().toLowerCase().replace(/ё/g, 'е');
  if (value === 'материал стен') return 'стены';
  if (value === 'площадь') return 'площадь дома';
  return value;
}

function getHouseSpecs(house, calculator) {
  const specs = house.specs || [];
  const fields = getHouseParameterFields(house, calculator);
  const managedLabels = new Set(['площадь дома', ...fields.map((field) => normalizeLabel(field.title))]);
  const rows = fields.map((field) => {
    const selected = field.options.filter((option) => field.selectedIds.includes(String(option.id)));
    const legacy = !Object.prototype.hasOwnProperty.call(house.parameters || {}, field.id)
      && specs.find((spec) => normalizeLabel(spec.label) === normalizeLabel(field.title));
    return {
      label: field.title,
      value: selected.map((option) => option.title).join(', ') || (legacy && legacy.value) || 'Не указано',
    };
  });
  return [
    { label: 'Площадь дома', value: house.area || 'Не указано' },
    ...rows,
    ...specs.filter((spec) => !managedLabels.has(normalizeLabel(spec.label))),
  ];
}

module.exports = { normalizeHouseParameters, getHouseParameterFields, getHouseSpecs };

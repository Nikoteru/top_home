const {
  columns, evaluateEstimate, getWorksheetRows, isBaseCell, normalizeEntry, validateTemplateFormulas,
} = require('../../public/js/estimate-formulas');

const fields = Object.keys(columns);

class EstimateValidationError extends Error {}

function title(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new EstimateValidationError(`Заполните поле «${field}».`);
  }
  return value.trim();
}

function rows(value) {
  if (!Array.isArray(value)) throw new EstimateValidationError('Проверьте структуру сметы.');
  return value;
}

function normalizeEstimateUnit(values) {
  return {
    label: title(values?.label, 'Название единицы'),
    value: title(values?.value, 'Обозначение'),
  };
}

function materialsFirst(left, right) {
  return Number(right.type === 'material') - Number(left.type === 'material');
}

function findConstructionStage(stage, constructionStages) {
  if (stage?.stageId !== undefined) {
    const id = typeof stage.stageId === 'number' ? String(stage.stageId) : stage.stageId;
    return constructionStages.find((entry) => String(entry.id) === id);
  }

  if (typeof stage?.title !== 'string') return;
  const name = stage.title.trim().toLowerCase();
  const matches = constructionStages.filter((entry) => entry.title.trim().toLowerCase() === name);
  if (matches.length === 1) return matches[0];
}

function estimateStageSelection(stage, existing, constructionStages) {
  const selected = findConstructionStage(stage, constructionStages);
  if (selected) return { stageId: String(selected.id), title: selected.title };

  const previous = existing?.stages.find((entry) => entry.stageId === stage?.stageId && entry.title === stage?.title);
  if (previous) return { stageId: previous.stageId, title: previous.title };

  throw new EstimateValidationError('Выберите этап из списка «Этапы стройки».');
}

function normalizeEstimateTemplate(draft, existing, constructionStages) {
  const savedMaterialIds = new Set((existing?.stages || []).flatMap((stage) => stage.groups)
    .filter((group) => group.type === 'material')
    .flatMap((group) => group.items.map((item) => item.materialId).filter(Boolean)));
  const template = {
    isTemplate: true,
    title: title(draft?.title, 'Название шаблона'),
    stages: rows(draft.stages).map((stage) => {
      const selection = estimateStageSelection(stage, existing, constructionStages);
      const groupTypes = new Set();
      const groups = rows(stage.groups).map((group) => {
        if (group?.type !== 'work' && group?.type !== 'material') {
          throw new EstimateValidationError('Укажите тип подблока.');
        }
        if (groupTypes.has(group.type)) {
          const groupTitle = group.type === 'work' ? 'Работы' : 'Материалы';
          throw new EstimateValidationError(`В этапе «${selection.title}» подблок «${groupTitle}» уже добавлен.`);
        }
        groupTypes.add(group.type);

        return {
          type: group.type,
          items: rows(group.items).map((item) => {
            const name = title(item?.title, 'Название позиции');
            const legacyBase = item.baseCells === undefined && typeof item.base === 'boolean';
            if (!legacyBase && (!Array.isArray(item.baseCells) || item.baseCells.some((field) => !fields.includes(field)))) {
              throw new EstimateValidationError(`Проверьте базовые ячейки позиции «${name}».`);
            }
            const baseCells = fields.filter((field) => isBaseCell(item, field));
            const formulas = {};
            for (const field of fields) {
              if (baseCells.includes(field)) continue;
              const expression = item.formulas?.[field];
              if (expression === undefined || expression === '') continue;
              if (typeof expression !== 'string') {
                throw new EstimateValidationError(`Проверьте формулы позиции «${name}».`);
              }
              if (expression.trim()) formulas[field] = expression.trim();
            }
            return {
              title: name,
              unit: title(item.unit, 'Единица измерения'),
              baseCells,
              formulas,
              ...(group.type === 'material' && savedMaterialIds.has(item.materialId) ? { materialId: item.materialId } : {}),
            };
          }),
        };
      });
      return { ...selection, groups: groups.sort(materialsFirst) };
    }),
  };
  checkCellErrors(validateTemplateFormulas(template));
  return template;
}

function asEstimateTemplate(estimate) {
  if (estimate.isTemplate) return estimate;
  const stages = estimate.stages.map((stage) => {
    const groups = new Map();
    for (const group of stage.groups) {
      const items = group.items.map(({ title, unit, materialId }) => ({
        title, unit, baseCells: [...fields], formulas: {}, ...(materialId ? { materialId } : {}),
      }));
      const first = groups.get(group.type);
      if (first) first.items.push(...items);
      else groups.set(group.type, { type: group.type, items });
    }
    return { title: stage.title, groups: [...groups.values()].sort(materialsFirst) };
  });
  return { id: estimate.id, revision: estimate.revision, title: estimate.title, isTemplate: true, stages };
}

function getEstimateEditorDraft(estimate, constructionStages) {
  const template = asEstimateTemplate(estimate);
  const stages = template.stages.map((stage) => {
    const selected = findConstructionStage(stage, constructionStages);
    return selected ? { ...stage, stageId: String(selected.id) } : stage;
  });
  return { ...template, stages };
}

function checkCellErrors(errors) {
  const first = Object.entries(errors)[0];
  if (!first) return;
  const [address, error] = first;
  throw new EstimateValidationError(`${address}: ${error.message}`);
}

function normalizeEstimateRun(draft, template) {
  const runTitle = title(draft.title, 'Название расчёта');
  const submitted = draft.entries;
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
    throw new EstimateValidationError('Проверьте структуру данных сметы.');
  }

  const worksheet = getWorksheetRows(template);
  const entries = {};
  for (const [row, values] of Object.entries(submitted)) {
    const number = Number(row);
    const position = worksheet.get(number);
    if (String(number) !== row || !position) {
      throw new EstimateValidationError(`Строка ${row} недоступна для ручного ввода.`);
    }
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new EstimateValidationError(`Проверьте данные строки ${row}.`);
    }
    const entry = {};
    for (const [field, value] of Object.entries(values)) {
      if (!fields.includes(field) || typeof value !== 'string') {
        throw new EstimateValidationError(`Проверьте данные строки ${row}.`);
      }
      if (!isBaseCell(position.item, field)) {
        throw new EstimateValidationError(`Ячейка ${columns[field]}${row} недоступна для ручного ввода.`);
      }
      if (!value.trim()) continue;
      const normalized = normalizeEntry(value, field);
      if (normalized === null) {
        throw new EstimateValidationError(`Проверьте числовое значение в строке ${row}.`);
      }
      entry[field] = normalized;
    }
    if (Object.keys(entry).length) entries[row] = entry;
  }

  const { errors, amountCents } = evaluateEstimate(template, entries);
  checkCellErrors(errors);
  const total = Object.values(amountCents).reduce((sum, amount) => sum + BigInt(amount ?? '0'), 0n);
  return { title: runTitle, entries, totalCents: String(total) };
}

module.exports = {
  EstimateValidationError, normalizeEstimateUnit, normalizeEstimateTemplate, asEstimateTemplate, getEstimateEditorDraft,
  normalizeEstimateRun,
};

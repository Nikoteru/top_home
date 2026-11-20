(function () {
  const form = document.querySelector('[data-estimate-form]');
  const draft = JSON.parse(form.querySelector('[data-estimate-data]').value);
  const footer = form.querySelector('[data-estimate-footer]');
  const table = footer.parentElement;
  let nextGroupId = 0;
  const saveButton = form.querySelector('[type="submit"]');
  const saveError = form.querySelector('[data-save-error]');
  const cellReference = /\b[DEF][1-9][0-9]*\b/gi;
  const { isBaseCell } = window.estimateFormulas;

  function showError(message) {
    saveError.textContent = message;
    saveError.hidden = false;
    saveError.focus();
  }

  function cloneRow(type) {
    return document.querySelector(`#estimate-${type}-template`).content.firstElementChild.cloneNode(true);
  }

  function setItemField(control, value = '') {
    if (control instanceof HTMLSelectElement && value && ![...control.options].some((option) => option.value === value)) {
      control.add(new Option(value, value));
    }
    control.value = value;
  }

  function updateUnitLabels(select) {
    for (const option of select.querySelectorAll('[data-unit-label]')) {
      option.textContent = option.selected ? option.value : option.dataset.unitLabel;
    }
  }

  function updateBaseCell(cell, base) {
    const formula = cell.querySelector('[data-cell-formula]');
    cell.classList.toggle('is-base-cell', base);
    formula.disabled = base;
    formula.hidden = base;
  }

  function addItem(groupTotalRow, savedValues) {
    const item = cloneRow('item');
    item.dataset.groupId = groupTotalRow.dataset.groupId;
    if (savedValues?.materialId) item.dataset.materialId = savedValues.materialId;
    for (const input of item.querySelectorAll('[data-item-field]')) {
      setItemField(input, savedValues?.[input.dataset.itemField]);
    }
    const unit = item.querySelector('[data-item-field="unit"]');
    if (!savedValues && [...unit.options].some((option) => option.value === 'шт.')) unit.value = 'шт.';
    updateUnitLabels(unit);
    for (const toggle of item.querySelectorAll('[data-base-cell]')) {
      const field = toggle.dataset.baseCell;
      const cell = toggle.closest('.estimate-formula-cell');
      const formula = cell.querySelector('[data-cell-formula]');
      toggle.checked = isBaseCell(savedValues, field);
      formula.value = savedValues?.formulas?.[field] || '';
      updateBaseCell(cell, toggle.checked);
    }
    groupTotalRow.before(item);
    return item;
  }

  function addGroup(stage, values) {
    const template = document.querySelector('#estimate-group-template');
    const rows = template.content.cloneNode(true);
    const [heading, total] = rows.children;
    const groupId = String(++nextGroupId);
    heading.dataset.groupId = groupId;
    total.dataset.groupId = groupId;
    heading.dataset.type = values.type;
    heading.querySelector('[data-group-title]').textContent = values.type === 'work' ? 'Работы' : 'Материалы';
    const work = values.type === 'material' && stage.querySelector('.estimate-group-heading[data-type="work"]');
    (work || stage.querySelector('[data-stage-actions]')).before(rows);
    for (const item of values.items) addItem(total, item);
    updateGroupButtons(stage);
    return total;
  }

  function updateGroupButtons(stage) {
    const groups = [...stage.querySelectorAll('.estimate-group-heading')];
    for (const button of stage.querySelectorAll('[data-add-group]')) {
      button.disabled = groups.some((group) => group.dataset.type === button.dataset.addGroup);
    }
  }

  function addStage(values = { groups: [] }) {
    const stage = cloneRow('stage');
    const select = stage.querySelector('[data-stage-id]');
    select.value = values.stageId ?? '';
    if (!select.value && values.title) {
      const option = new Option(`${values.title} (из шаблона)`, values.stageId ?? 'saved');
      option.dataset.savedStageTitle = values.title;
      select.add(option);
      select.value = option.value;
    }
    footer.before(stage);
    for (const group of values.groups) addGroup(stage, group);
    return stage;
  }

  function groupRows(stage, groupId) {
    return [...stage.querySelectorAll(`tr[data-group-id="${groupId}"]`)];
  }

  function numberSheetRows() {
    let sheetRow = 0;
    let itemNumber = 0;
    for (const row of table.rows) {
      const sheetIndex = row.cells[0];
      if (sheetIndex.hasAttribute('data-sheet-row')) sheetIndex.textContent = ++sheetRow;
      if (row.classList.contains('estimate-group-heading')) itemNumber = 0;
      const positionIndex = row.querySelector('[data-item-number]');
      if (positionIndex) positionIndex.textContent = ++itemNumber;
    }
  }

  function formulaRows() {
    return new Map([...table.querySelectorAll('.estimate-item')].map((row) => [row.cells[0].textContent, row]));
  }

  function updateFormulaAddresses(previousRows) {
    for (const input of table.querySelectorAll('[data-cell-formula]:not(:disabled)')) {
      const nextFormula = input.value.replace(cellReference, (reference) => {
        const target = previousRows.get(reference.slice(1));
        return target ? reference[0] + target.cells[0].textContent : reference;
      });
      if (nextFormula !== input.value) input.value = nextFormula;
    }
  }

  function canRemoveRows(rows, worksheetRows) {
    const removed = new Set(rows);
    for (const [number, row] of worksheetRows) {
      if (removed.has(row)) continue;
      for (const input of row.querySelectorAll('[data-cell-formula]:not(:disabled)')) {
        const reference = (input.value.match(cellReference) || [])
          .find((address) => removed.has(worksheetRows.get(address.slice(1))));
        if (reference) {
          showError(`Ячейка ${input.dataset.column}${number} ссылается на ${reference.toUpperCase()}. Сначала измените формулу.`);
          return false;
        }
      }
    }
    return true;
  }

  function readItem(row) {
    const item = Object.fromEntries([...row.querySelectorAll('[data-item-field]')]
      .map((input) => [input.dataset.itemField, input.value]));
    item.baseCells = [...row.querySelectorAll('[data-base-cell]:checked')].map((toggle) => toggle.dataset.baseCell);
    item.formulas = Object.fromEntries([...row.querySelectorAll('[data-cell-formula]:not(:disabled)')]
      .filter((input) => input.value.trim())
      .map((input) => [input.dataset.cellFormula, input.value.trim()]));
    if (row.dataset.materialId) item.materialId = row.dataset.materialId;
    return item;
  }

  function readStage(stage) {
    const select = stage.querySelector('[data-stage-id]');
    return {
      stageId: select.value === 'saved' ? undefined : select.value,
      title: select.selectedOptions[0]?.dataset.savedStageTitle,
      groups: [...stage.querySelectorAll('.estimate-group-heading')].map((group) => ({
        type: group.dataset.type,
        items: groupRows(stage, group.dataset.groupId).slice(1, -1).map(readItem),
      })),
    };
  }

  function readTemplate() {
    return {
      title: form.querySelector('[data-estimate-title]').value,
      stages: [...table.tBodies].map(readStage),
      revision: draft.revision,
    };
  }

  form.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.type !== 'button' || button.disabled || saveButton.disabled) return;
    saveError.hidden = true;
    const previousRows = formulaRows();

    if (button.hasAttribute('data-add-stage')) {
      addStage().querySelector('[data-stage-id]').focus();
    } else if (button.hasAttribute('data-add-group')) {
      const stage = button.closest('.estimate-stage');
      const group = addGroup(stage, { type: button.dataset.addGroup, items: [] });
      group.querySelector('[data-add-item]').focus();
    } else if (button.hasAttribute('data-add-item')) {
      addItem(button.closest('tr')).querySelector('select, input:not([type="hidden"])').focus();
    } else if (button.hasAttribute('data-remove-item')) {
      const item = button.closest('.estimate-item');
      if (!canRemoveRows([item], previousRows)) return;
      const rows = groupRows(item.closest('.estimate-stage'), item.dataset.groupId);
      item.remove();
      rows.at(-1).querySelector('[data-add-item]').focus();
    } else if (button.hasAttribute('data-remove-group')) {
      const group = button.closest('tr');
      const stage = group.closest('.estimate-stage');
      const rows = groupRows(stage, group.dataset.groupId);
      if (!canRemoveRows(rows, previousRows)) return;
      if (rows.length > 2 && !window.confirm('Удалить подблок со всеми позициями?')) return;
      rows.forEach((row) => row.remove());
      updateGroupButtons(stage);
      stage.querySelector(`[data-add-group="${group.dataset.type}"]`).focus();
    } else if (button.hasAttribute('data-remove-stage')) {
      const stage = button.closest('.estimate-stage');
      if (!canRemoveRows(stage.querySelectorAll('.estimate-item'), previousRows)) return;
      if (stage.querySelector('.estimate-group-heading') && !window.confirm('Удалить этап со всеми подблоками?')) return;
      stage.remove();
      form.querySelector('[data-add-stage]')?.focus();
    }
    numberSheetRows();
    updateFormulaAddresses(previousRows);
  });

  form.addEventListener('change', (event) => {
    const control = event.target;
    if (control.matches('[data-item-field="unit"]')) updateUnitLabels(control);
    if (!control.matches('[data-base-cell]')) return;

    const cell = control.closest('.estimate-formula-cell');
    const formula = cell.querySelector('[data-cell-formula]');
    if (control.checked && formula.value.trim()) {
      if (!window.confirm('Сделать ячейку базовой и очистить формулу?')) {
        control.checked = false;
        return;
      }
      formula.value = '';
    }
    updateBaseCell(cell, control.checked);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    saveError.hidden = true;
    saveButton.disabled = true;
    const values = readTemplate();
    const controls = [...form.querySelectorAll('input:not(:disabled), select:not(:disabled)')];
    controls.forEach((control) => { control.disabled = true; });
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) throw new Error(result.error || 'Не удалось сохранить шаблон.');
      window.location.assign(result.url);
    } catch (error) {
      showError(error.message);
      saveButton.disabled = false;
      controls.forEach((control) => { control.disabled = false; });
    }
  });

  draft.stages.forEach(addStage);
  numberSheetRows();
})();

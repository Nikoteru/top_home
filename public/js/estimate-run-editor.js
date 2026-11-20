(() => {
  const form = document.querySelector('[data-estimate-run-form]');
  const { template, runId, revision } = JSON.parse(form.querySelector('[data-estimate-run-data]').value);
  const { getWorksheetRows, evaluateEstimate } = window.estimateFormulas;
  const { formatTotal } = window.estimateTotals;
  const worksheet = getWorksheetRows(template);
  const inputs = [...form.querySelectorAll('[data-run-entry]')];
  const outputs = [...form.querySelectorAll('[data-run-result]')];
  const groupTotals = [...form.querySelectorAll('[data-run-group-total]')];
  const stageTotals = [...form.querySelectorAll('[data-run-stage-total]')];
  const grandTotal = form.querySelector('[data-run-total]');
  const title = form.querySelector('[data-run-title]');
  const saveButton = form.querySelector('[type="submit"]');
  const saveError = form.querySelector('[data-run-save-error]');
  const calculationError = form.querySelector('[data-run-calculation-error]');
  const priceFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  const quantityFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 8 });

  function readEntries() {
    const entries = {};
    for (const input of inputs) {
      const { runRow, runEntry } = input.dataset;
      const value = input.value.trim();
      if (value) (entries[runRow] ??= {})[runEntry] = value;
    }
    return entries;
  }

  function showCellError(cell, error) {
    cell.toggleAttribute('data-run-invalid', Boolean(error));
    if (error) {
      cell.title = error.message;
      cell.setAttribute('aria-invalid', 'true');
    } else {
      cell.removeAttribute('title');
      cell.removeAttribute('aria-invalid');
    }
  }

  function updateTotals(amountCents) {
    const groups = new Map();
    const stages = new Map();
    let total = 0n;
    for (const [row, { stageIndex, groupIndex }] of worksheet) {
      const amount = BigInt(amountCents[row] ?? 0);
      const group = stageIndex + ':' + groupIndex;
      groups.set(group, (groups.get(group) ?? 0n) + amount);
      stages.set(stageIndex, (stages.get(stageIndex) ?? 0n) + amount);
      total += amount;
    }
    for (const cell of groupTotals) cell.textContent = formatTotal(groups.get(cell.dataset.runGroupTotal) ?? 0n);
    for (const cell of stageTotals) cell.textContent = formatTotal(stages.get(Number(cell.dataset.runStageTotal)) ?? 0n);
    grandTotal.textContent = formatTotal(total);
  }

  function updateCalculation(entries) {
    const { rows, errors, amountCents } = evaluateEstimate(template, entries);
    for (const output of outputs) {
      const { runRow, runResult, runAddress } = output.dataset;
      const error = errors[runAddress];
      const value = rows[runRow][runResult];
      if (error) output.textContent = '#ОШИБКА';
      else if (value === null) output.textContent = '—';
      else if (runResult === 'amount') output.textContent = formatTotal(BigInt(amountCents[runRow]));
      else output.textContent = (runResult === 'price' ? priceFormat : quantityFormat).format(value);
      showCellError(output, error);
    }
    for (const input of inputs) {
      const { runRow, runEntry, runAddress } = input.dataset;
      const error = errors[runAddress];
      if (runEntry === 'amount') {
        input.placeholder = amountCents[runRow] === null ? '—' : formatTotal(BigInt(amountCents[runRow]));
      }
      showCellError(input, error);
    }
    updateTotals(amountCents);

    const firstError = Object.entries(errors)[0];
    const message = firstError ? `${firstError[0]} — ${firstError[1].message}` : '';
    if (calculationError.textContent !== message) calculationError.textContent = message;
    calculationError.hidden = !firstError;
    return !firstError;
  }

  form.addEventListener('input', (event) => {
    if (event.target.matches('[data-run-entry]')) updateCalculation(readEntries());
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    saveError.hidden = true;
    const entries = readEntries();
    if (!updateCalculation(entries)) {
      calculationError.focus();
      return;
    }

    const values = { title: title.value.trim(), entries };
    if (runId) values.revision = revision;
    else {
      values.templateId = template.id;
      values.templateRevision = template.revision;
    }
    const controls = [title, ...inputs, saveButton];
    for (const control of controls) control.disabled = true;
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) throw new Error(result.error || 'Не удалось сохранить смету.');
      window.location.assign(result.url);
    } catch (error) {
      saveError.textContent = error.message;
      saveError.hidden = false;
      for (const control of controls) control.disabled = false;
    }
  });

  updateCalculation(readEntries());
})();

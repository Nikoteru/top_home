(() => {
  const form = document.querySelector('[data-inclusion-form]');
  if (!form) return;

  const stages = [...form.querySelectorAll('[data-inclusion-stage]')];
  const tabs = new Map([...form.querySelectorAll('[data-inclusion-tab]')]
    .map((tab) => [tab.getAttribute('aria-controls'), tab]));
  const saveButton = form.querySelector('[type="submit"]');
  const message = form.querySelector('[data-inclusion-error]');
  const itemTemplate = document.getElementById('inclusion-item-template');

  function refreshOrder(list) {
    const entries = [...list.children];
    entries.forEach((entry, index) => {
      entry.querySelector('[data-move-entry="up"]').disabled = index === 0;
      entry.querySelector('[data-move-entry="down"]').disabled = index === entries.length - 1;
    });
    const panel = list.closest('[data-inclusion-stage]');
    panel.querySelector('[data-empty-stage]').hidden = entries.length > 0;
    const count = tabs.get(panel.id).querySelector('[data-item-count]');
    count.textContent = entries.length;
    count.hidden = entries.length === 0;
  }

  function appendItem(list, values = {}) {
    const item = itemTemplate.content.firstElementChild.cloneNode(true);
    item.querySelector('[data-item-title]').value = values.title ?? '';
    item.querySelector('[data-item-description]').value = values.description ?? '';
    list.append(item);
    return item;
  }

  function readInclusions() {
    return {
      title: form.querySelector('[data-inclusion-title]').value,
      note: form.querySelector('[data-inclusion-note]').value,
      sections: stages.map((stage) => ({
        stageId: stage.dataset.inclusionStage,
        items: [...stage.querySelector('[data-inclusion-items]').children].map((item) => ({
          title: item.querySelector('[data-item-title]').value,
          description: item.querySelector('[data-item-description]').value,
        })),
      })).filter(({ items }) => items.length > 0),
      assignments: Object.fromEntries([...form.querySelectorAll('[data-inclusion-assignment]')]
        .map((select) => [select.dataset.inclusionAssignment, select.value])),
    };
  }

  form.addEventListener('click', (event) => {
    const button = event.target.closest('button[type="button"]');
    if (!button || button.disabled || saveButton.disabled) return;
    message.hidden = true;

    if (button.hasAttribute('data-add-item')) {
      const list = button.closest('[data-inclusion-stage]').querySelector('[data-inclusion-items]');
      const item = appendItem(list);
      refreshOrder(list);
      item.querySelector('[data-item-title]').focus();
      return;
    }

    const entry = button.closest('[data-inclusion-entry]');
    if (!entry) return;
    const list = entry.parentElement;
    if (button.hasAttribute('data-remove-entry')) {
      const neighbour = entry.nextElementSibling || entry.previousElementSibling;
      const fallback = list.closest('[data-inclusion-stage]').querySelector('[data-add-item]');
      entry.remove();
      refreshOrder(list);
      (neighbour?.querySelector('input') || fallback).focus();
      return;
    }

    if (button.dataset.moveEntry === 'up') entry.previousElementSibling.before(entry);
    else entry.nextElementSibling.after(entry);
    refreshOrder(list);
    (button.disabled ? entry.querySelector('input') : button).focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    const blank = [...form.querySelectorAll('[required]')].find((input) => !input.value.trim());
    if (blank) {
      tabs.get(blank.closest('[data-inclusion-stage]').id).click();
      blank.value = '';
      blank.focus();
      blank.reportValidity();
      return;
    }
    const values = readInclusions();
    const controls = [...form.querySelectorAll('input, textarea, select, button')].filter((control) => !control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    message.hidden = true;
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) throw new Error(result.error || 'Не удалось сохранить комплектацию.');
      window.location.assign(result.url);
    } catch (error) {
      controls.forEach((control) => { control.disabled = false; });
      message.textContent = error.message;
      message.hidden = false;
      message.focus();
    }
  });

  const saved = new Map(JSON.parse(form.querySelector('[data-inclusion-data]').value)
    .map(({ stageId, items }) => [stageId, items]));
  for (const stage of stages) {
    const list = stage.querySelector('[data-inclusion-items]');
    for (const item of saved.get(stage.dataset.inclusionStage) || []) appendItem(list, item);
    refreshOrder(list);
  }
})();

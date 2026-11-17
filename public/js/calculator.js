// Калькулятор стоимости дома: мгновенный пересчёт на клиенте.
// Формула совпадает с серверной (src/utils/calc.js):
//   итого = площадь × Σ(цены «за м²») × Π(коэффициенты) + Σ(фикс. суммы)
document.addEventListener('DOMContentLoaded', () => {
  const configEl = document.getElementById('calcConfig');
  if (!configEl) return;
  const config = JSON.parse(configEl.textContent);

  const form = document.getElementById('calcForm');
  const range = document.getElementById('calcAreaRange');
  const areaInput = document.getElementById('calcAreaInput');
  const totalEl = document.getElementById('calcTotal');
  const perM2El = document.getElementById('calcPerM2');
  const linesEl = document.getElementById('calcLines');
  const mobileTotalEl = document.getElementById('calcMobileTotal');
  const calcField = document.getElementById('calcField');

  const areaCfg = config.area || { min: 1, max: 10000, step: 1, default: 100 };

  const num = (v, fallback = 0) => {
    const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  };
  const rub = (v) => `${Math.round(v).toLocaleString('ru-RU')} ₽`;
  const clampArea = (v) => Math.min(areaCfg.max, Math.max(areaCfg.min, Math.round(num(v, areaCfg.default))));

  function getSelection() {
    const selection = {};
    form.querySelectorAll('.calc-option__input:checked').forEach((input) => {
      const blockId = input.dataset.blockId;
      (selection[blockId] = selection[blockId] || []).push(input.value);
    });
    return selection;
  }

  function calculate(area, selection) {
    const chosen = [];
    config.blocks.forEach((block) => {
      const ids = selection[block.id] || [];
      let picked = block.options.filter((o) => ids.includes(String(o.id)));
      if (!block.multiple) picked = picked.length ? [picked[0]] : block.options.slice(0, 1);
      picked.forEach((option) => chosen.push({ block, option }));
    });

    const coef = chosen
      .filter((c) => c.option.unit === 'coef')
      .reduce((acc, c) => acc * (num(c.option.price, 1) || 1), 1);

    let total = 0;
    const lines = chosen.map(({ block, option }) => {
      const price = num(option.price);
      let amount = 0;
      if (option.unit === 'm2') amount = area * price * coef;
      else if (option.unit === 'fixed') amount = price;
      total += amount;
      return { block: block.title, option: option.title, unit: option.unit, amount };
    });

    total = Math.round(total / 1000) * 1000;
    return { total, perM2: area ? Math.round(total / area) : 0, lines };
  }

  function update() {
    const area = clampArea(areaInput.value);
    const selection = getSelection();
    const result = calculate(area, selection);

    totalEl.textContent = rub(result.total);
    mobileTotalEl.textContent = rub(result.total);
    perM2El.innerHTML = '';
    perM2El.append(`≈ ${rub(result.perM2)} за м² · ${area} м²`);

    linesEl.innerHTML = '';
    result.lines.forEach((line) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${line.block}: ${line.option}`;
      const value = document.createElement('b');
      value.textContent = line.unit === 'coef' ? '' : rub(line.amount);
      li.append(label, value);
      linesEl.append(li);
    });

    if (calcField) calcField.value = JSON.stringify({ area, selection });
  }

  // Ползунок и поле ввода площади синхронизированы между собой.
  range.addEventListener('input', () => {
    areaInput.value = range.value;
    update();
  });
  areaInput.addEventListener('input', () => {
    if (areaInput.value === '') return;
    range.value = clampArea(areaInput.value);
    update();
  });
  areaInput.addEventListener('change', () => {
    areaInput.value = clampArea(areaInput.value);
    range.value = areaInput.value;
    update();
  });

  form.addEventListener('change', (e) => {
    if (e.target.classList.contains('calc-option__input')) update();
  });

  // Нижняя плашка с итогом на телефоне прячется, когда видна основная карточка итога.
  const bar = document.getElementById('calcMobileBar');
  const summary = document.getElementById('calcSummary');
  const formSection = document.getElementById('form');
  if (bar && 'IntersectionObserver' in window) {
    const visible = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => (en.isIntersecting ? visible.add(en.target) : visible.delete(en.target)));
      bar.classList.toggle('is-hidden', visible.size > 0);
    });
    if (summary) io.observe(summary);
    if (formSection) io.observe(formSection);
  }

  update();
});

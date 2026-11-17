// Расчёт стоимости в калькуляторе. Та же формула продублирована на клиенте
// (public/js/calculator.js) для мгновенного пересчёта; здесь — серверная
// версия, по которой в заявку записывается конфигурация из калькулятора
// (цены берутся из текущих настроек, а не из того, что прислал браузер).
//
// Формула:  итого = площадь × Σ(цены «за м²») × Π(коэффициенты) + Σ(фикс. суммы)

const UNITS = {
  m2: 'за м²',
  fixed: 'фиксированная сумма',
  coef: 'коэффициент',
};

function toNumber(value, fallback = 0) {
  const n = Number(String(value === undefined || value === null ? '' : value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// selection: { [blockId]: [optionId, ...] } — для блоков с одиночным
// выбором учитывается только первый вариант; если ничего не выбрано —
// берётся первый вариант блока (как и в интерфейсе по умолчанию).
function calculate(config, rawArea, selection = {}) {
  const areaCfg = config.area || {};
  const area = clamp(Math.round(toNumber(rawArea, areaCfg.default)), areaCfg.min || 1, areaCfg.max || 10000);

  const chosen = [];
  (config.blocks || []).forEach((block) => {
    const options = block.options || [];
    if (!options.length) return;
    const ids = (selection[block.id] || []).map(String);
    let picked = options.filter((o) => ids.includes(String(o.id)));
    if (!block.multiple) picked = picked.length ? [picked[0]] : [options[0]];
    picked.forEach((option) => chosen.push({ block, option }));
  });

  const coef = chosen
    .filter((c) => c.option.unit === 'coef')
    .reduce((acc, c) => acc * (toNumber(c.option.price, 1) || 1), 1);

  let total = 0;
  const lines = chosen.map(({ block, option }) => {
    const price = toNumber(option.price);
    let amount = 0;
    if (option.unit === 'm2') amount = area * price * coef;
    else if (option.unit === 'fixed') amount = price;
    total += amount;
    return { blockTitle: block.title, optionTitle: option.title, unit: option.unit, price, amount };
  });

  total = Math.round(total / 1000) * 1000;
  return { area, coef, total, perM2: area ? Math.round(total / area) : 0, lines };
}

function formatRub(value) {
  return `${Math.round(value).toLocaleString('ru-RU').replace(/ /g, ' ')} ₽`;
}

// Короткое текстовое описание расчёта — для заявки в админке и Excel.
function describe(result) {
  const parts = result.lines.map((l) => `${l.blockTitle}: ${l.optionTitle}`);
  return `Калькулятор: ${result.area} м²; ${parts.join('; ')}. Итого ≈ ${formatRub(result.total)}`;
}

module.exports = { UNITS, toNumber, calculate, describe, formatRub };

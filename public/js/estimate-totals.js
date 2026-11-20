(function () {
  function decimalUnits(value, precision) {
    if (typeof value !== 'string') return null;
    const parts = /^(\d{1,9})(?:[.,](\d+))?$/.exec(value.trim());
    if (!parts || (parts[2] && parts[2].length > precision)) return null;
    return BigInt(parts[1] + (parts[2] || '').padEnd(precision, '0'));
  }

  function itemTotal(item) {
    const price = decimalUnits(item.price, 2);
    const quantity = decimalUnits(item.quantity, 3);
    if (price === null || quantity === null) return null;
    return (price * quantity + 500n) / 1000n;
  }

  function formatTotal(kopecks) {
    const negative = kopecks < 0n;
    const absolute = negative ? -kopecks : kopecks;
    const rubles = (absolute / 100n).toLocaleString('ru-RU');
    const fraction = String(absolute % 100n).padStart(2, '0');
    return `${negative ? '−' : ''}${rubles},${fraction} ₽`;
  }

  const totals = { itemTotal, formatTotal };
  if (typeof module === 'object') module.exports = totals;
  else window.estimateTotals = totals;
})();

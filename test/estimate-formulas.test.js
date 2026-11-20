const assert = require('node:assert/strict');
const test = require('node:test');
const { getWorksheetRows, validateTemplateFormulas, evaluateEstimate } = require('../public/js/estimate-formulas');

const base = { title: 'Базовая', unit: 'шт.', base: true };
const formula = (formulas) => ({ title: 'По формуле', unit: 'шт.', base: false, formulas });
const templateOf = (...items) => ({ stages: [{ groups: [{ items }] }] });

test('formula addresses match visible worksheet rows across groups and stages', () => {
  const template = { stages: [
    { groups: [{ items: [base, base] }, { items: [base] }] },
    { groups: [{ items: [base] }] },
  ] };
  assert.deepEqual([...getWorksheetRows(template).keys()], [4, 5, 8, 14]);
});

test('references resolve across formulas and preserve cent rounding', () => {
  const template = templateOf(
    base,
    formula({ price: '=d4/2', quantity: '=(E4 + 1,5)', amount: '=D5 * E5 + f4' }),
    formula({ amount: '=-1,005' }),
    formula({ amount: '=F6*2' }),
  );
  const result = evaluateEstimate(template, { 4: { price: '12,05', quantity: '1,5' } });
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.rows[5], { price: 6.025, quantity: 3, amount: 36.16 });
  assert.deepEqual(result.amountCents, { 4: '1808', 5: '3616', 6: '-101', 7: '-202' });
});

test('unfinished inputs stay empty, zero is calculated, explicit base amount wins', () => {
  const template = templateOf(base, formula({ amount: '=F4+E4' }));
  const blank = evaluateEstimate(template, { 4: { price: '20' } });
  assert.equal(blank.rows[4].amount, null);
  assert.equal(blank.rows[5].amount, null);
  assert.deepEqual(blank.errors, {});
  const zero = evaluateEstimate(template, { 4: { price: '20', quantity: '0', amount: '1,23' } });
  assert.deepEqual(zero.amountCents, { 4: '123', 5: '123' });
  assert.equal(evaluateEstimate(template, { 4: { price: '20', quantity: '0' } }).amountCents[4], '0');
  assert.equal(evaluateEstimate(template, { 4: { price: '20,999' } }).errors.D4.code, 'input');
});

test('a row can mix manual cells, formula cells and automatic amounts', () => {
  const template = templateOf(
    { baseCells: ['quantity'], formulas: { price: '=25', amount: '=D4*E4+1' } },
    { baseCells: ['quantity', 'amount'], formulas: { price: '=F5/E5' } },
    { baseCells: ['price', 'quantity'] },
    { baseCells: [], formulas: { amount: '=F4+F5+F6' } },
    { baseCells: ['amount'], formulas: { price: '=4', quantity: '=3' } },
  );
  assert.deepEqual(validateTemplateFormulas(template), {});

  const entries = {
    4: { price: '99', quantity: '2' },
    5: { quantity: '2' },
    6: { price: '3', quantity: '4', amount: '99' },
  };
  const incomplete = evaluateEstimate(template, entries);
  assert.deepEqual(incomplete.errors, {});
  assert.equal(incomplete.amountCents[5], null);
  assert.equal(incomplete.amountCents[8], '1200');

  const completed = evaluateEstimate(template, { ...entries, 5: { quantity: '2', amount: '8' } });
  assert.deepEqual(completed.errors, {});
  assert.deepEqual(completed.rows[5], { price: 4, quantity: 2, amount: 8 });
  assert.deepEqual(completed.amountCents, { 4: '5100', 5: '800', 6: '1200', 7: '7100', 8: '1200' });
});

test('supports mathematical precedence, powers and signed constants', () => {
  const template = templateOf(formula({
    price: '=-2^2+2^-2',
    quantity: '=2^3^2',
    amount: '=(2+5)*3 + (-2)^2 + .5 + 4^0,5',
  }));
  const result = evaluateEstimate(template);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.rows[4], { price: -3.75, quantity: 512, amount: 27.5 });
});

test('rejects forbidden cell references, unsupported syntax and cycles', () => {
  const template = templateOf(
    formula({ price: '=F5' }),
    formula({ amount: '=D4' }),
    formula({ price: '=D2', quantity: '=B4', amount: '=2+alert(1)' }),
    formula({}),
  );
  const errors = validateTemplateFormulas(template);
  assert.equal(errors.D4.code, 'cycle');
  assert.equal(errors.F5.code, 'cycle');
  assert.equal(errors.D6.code, 'ref');
  assert.equal(errors.E6.code, 'ref');
  assert.equal(errors.F6.code, 'syntax');
  assert.equal(errors.F7.code, 'required');
  for (const amount of ['=()', '=1(', '=2+', '=1 2', '=alert(1)', '1+2', '=2**3']) {
    assert.equal(validateTemplateFormulas(templateOf(formula({ amount }))).F4.code, 'syntax');
  }
});

test('reports division by zero from entered values and checks very large totals exactly', () => {
  const template = templateOf(base, formula({ amount: '=D4/E4' }));
  assert.deepEqual(validateTemplateFormulas(template), {});
  const zero = evaluateEstimate(template, { 4: { price: '10', quantity: '0' } });
  assert.equal(zero.errors.F5.code, 'zero');
  assert.equal(zero.amountCents[5], null);
  const large = evaluateEstimate(templateOf(base), { 4: { price: '999999999.99', quantity: '999999999.999' } });
  assert.equal(large.amountCents[4], '99999999998900000000');
});

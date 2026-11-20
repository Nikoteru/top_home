const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { normalizeHouseParameters, getHouseParameterFields, getHouseSpecs } = require('../src/utils/houseParameters');
const content = require('../src/data/content.json');

test('project selections accept only current options and respect single/multiple choice', () => {
  const selection = normalizeHouseParameters(content.calculator, {
    1: ['3', '2', 'invalid'],
    2: '5',
    3: { id: '8' },
    7: ['29', '23', '23', '999'],
    999: ['1'],
  });
  assert.deepEqual(selection[1], ['2']);
  assert.deepEqual(selection[2], ['5']);
  assert.deepEqual(selection[3], []);
  assert.deepEqual(selection[7], ['23', '29']);
  assert.equal(Object.hasOwn(selection, 999), false);
});

test('unspecified project values stay empty instead of taking calculator defaults', () => {
  const fields = getHouseParameterFields({}, content.calculator);
  assert.equal(fields.length, content.calculator.blocks.length);
  assert.ok(fields.every((field) => field.selectedIds.length === 0));
  assert.deepEqual(normalizeHouseParameters(undefined, { 1: '1' }), {});
  const specs = getHouseSpecs({ area: '120 м²' }, content.calculator);
  assert.equal(specs.find((spec) => spec.label === 'Фундамент').value, 'Не указано');
});

test('tables use the project area, keep additional specs and avoid duplicate managed rows', () => {
  const house = {
    area: '155 м²',
    parameters: { 3: ['11'], 7: ['26', '23'] },
    specs: [
      { label: 'Площадь дома', value: '100 м²' },
      { label: 'Материал стен', value: 'Старый материал' },
      { label: 'Спальни', value: '3' },
    ],
  };
  const specs = getHouseSpecs(house, content.calculator);
  assert.equal(specs[0].value, '155 м²');
  assert.equal(specs.find((spec) => spec.label === 'Стены').value, 'Клеёный брус');
  assert.equal(specs.find((spec) => spec.label === 'Дополнительно').value, 'Терраса, Тёплые полы');
  assert.equal(specs.filter((spec) => spec.label === 'Площадь дома').length, 1);
  assert.equal(specs.some((spec) => spec.label === 'Материал стен'), false);
  assert.deepEqual(specs.at(-1), { label: 'Спальни', value: '3' });
  const legacy = getHouseSpecs({ specs: house.specs }, content.calculator);
  assert.equal(legacy.find((spec) => spec.label === 'Стены').value, 'Старый материал');
});

test('calculator renaming, new blocks and removed options are reflected in project fields', () => {
  const calculator = structuredClone(content.calculator);
  calculator.blocks[0].title = 'Количество этажей';
  calculator.blocks[0].options[0].title = 'Одноэтажный';
  calculator.blocks.push({ id: 8, title: 'Окна', options: [{ id: 31, title: 'Деревянные' }] });
  const house = { parameters: { 1: ['1'], 7: ['999'] } };
  const specs = getHouseSpecs(house, calculator);
  assert.equal(specs.find((spec) => spec.label === 'Количество этажей').value, 'Одноэтажный');
  assert.equal(specs.find((spec) => spec.label === 'Окна').value, 'Не указано');
  assert.equal(specs.find((spec) => spec.label === 'Дополнительно').value, 'Не указано');
  for (const existing of content.houses) {
    assert.deepEqual(normalizeHouseParameters(content.calculator, existing.parameters), existing.parameters);
  }
});

test('admin forms save and clear multipart selections, and calculator deletion cleans references', async (t) => {
  let state = structuredClone(content);
  const store = require('../src/data/store');
  const leads = require('../src/data/leadsStore');
  t.mock.method(store, 'getContent', () => structuredClone(state));
  t.mock.method(store, 'saveContent', (updated) => { state = structuredClone(updated); });
  t.mock.method(leads, 'getLeads', () => []);
  const express = require('express');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = { isAdmin: req.get('x-test-admin') === '1' };
    next();
  });
  app.use('/admin', require('../src/routes/admin'));
  app.use('/', require('../src/routes/public'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function submit(route, entries, authenticated = true) {
    const body = new FormData();
    for (const [key, value] of entries) body.append(key, value);
    const response = await fetch(base + route, {
      method: 'POST', body, redirect: 'manual', headers: { 'x-test-admin': authenticated ? '1' : '0' },
    });
    assert.equal(response.status, 302, await response.text());
    return response;
  }

  const denied = await submit('/admin/house/1', [['parametersPresent', '1']], false);
  assert.equal(denied.headers.get('location'), '/admin/login');
  assert.deepEqual(state.houses[0].parameters, content.houses[0].parameters);

  await submit('/admin/house/1', [
    ['parametersPresent', '1'], ['area', '210 м²'],
    ['parameters[1]', '3'], ['parameters[2]', '5'], ['parameters[3]', '12'],
    ['parameters[4]', '15'], ['parameters[5]', '19'], ['parameters[6]', '22'],
    ['parameters[7][]', '23'], ['parameters[7][]', '29'], ['parameters[7][]', '999'],
  ]);
  assert.deepEqual(state.houses[0].parameters[3], ['12']);
  assert.deepEqual(state.houses[0].parameters[7], ['23', '29']);
  assert.deepEqual(state.houses[1], content.houses[1]);
  const page = await fetch(base + '/houses/1');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /210 м²/);
  assert.match(html, /Терраса, Септик/);
  const adminPage = await fetch(base + '/admin/houses', { headers: { 'x-test-admin': '1' } });
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  const form = adminHtml.split('action="/admin/house/1"')[1].split('</form>')[0];
  assert.match(form, /name="parameters\[3\]"[\s\S]*?value="12" selected/);
  assert.match(form, /name="parameters\[7\]\[\]" value="29" checked/);

  await submit('/admin/house/1', [['parametersPresent', '1']]);
  assert.ok(Object.values(state.houses[0].parameters).every((ids) => ids.length === 0));
  assert.deepEqual(state.houses[0].specs, content.houses[0].specs);

  const created = await submit('/admin/house', [
    ['title', 'Тестовый проект'], ['parametersPresent', '1'],
    ['parameters[1]', '2'], ['parameters[7][]', '25'],
  ]);
  const house = state.houses.at(-1);
  assert.deepEqual(house.parameters[1], ['2']);
  assert.deepEqual(house.parameters[7], ['25']);
  assert.match(created.headers.get('location'), new RegExp(`open=${house.id}$`));

  await submit('/admin/calculator/blocks/1', [
    ['title', 'Этажность'], ['options[0][id]', '2'], ['options[0][remove]', '1'],
  ]);
  assert.deepEqual(state.houses.at(-1).parameters[1], []);
  await submit('/admin/calculator/blocks/7/delete', []);
  assert.ok(state.houses.every((item) => !Object.hasOwn(item.parameters, 7)));
});

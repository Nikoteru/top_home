const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const { normalizeProjectFilters, projectArea, matchProjects, describeProjectFilters } = require('../src/utils/projectMatcher');
const content = require('../src/data/content.json');
const calc = content.calculator;
const ids = (filters, houses = content.houses) => matchProjects(houses, calc, filters).map((house) => house.id);

test('area is an inclusive interval, including an interval consisting of a single value', () => {
  assert.deepEqual(ids({ areaMin: 98, areaMax: 146 }), [1, 2, 3]);
  assert.deepEqual(ids({ areaMin: 146, areaMax: 146 }), [1]);
  assert.deepEqual(ids({ areaMin: 200, areaMax: 300 }), []);
  assert.equal(projectArea('98,5 м²'), 98.5);
  assert.equal(projectArea('1 200 м²'), 1200);
  assert.equal(projectArea('Не указано'), null);
  assert.equal(projectArea('-100 м²'), null);
});

test('range bounds are clamped, reversed bounds reordered, and invalid bounds use limits', () => {
  const normalized = normalizeProjectFilters(calc, { areaMin: '146', areaMax: '98' });
  assert.equal(normalized.areaMin, 98);
  assert.equal(normalized.areaMax, 146);
  const clamped = normalizeProjectFilters(calc, { areaMin: -999, areaMax: Infinity });
  assert.equal(clamped.areaMin, calc.area.min);
  assert.equal(clamped.areaMax, calc.area.max);
  assert.deepEqual(ids({ areaMin: '', areaMax: ['99'] }), [1, 2, 3, 4, 5]);
});

test('empty additional options are ignored, so projects without extras remain eligible', () => {
  assert.deepEqual(ids({ selection: { 7: [] } }), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids({ selection: {} }), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids({ selection: { 7: ['23'] } }), [1, 4]);
  assert.deepEqual(ids({ selection: { 7: ['23', '24'] } }), [4]);
  assert.deepEqual(ids({ selection: { 7: ['23', '25'] } }), []);
});

test('all chosen characteristics and the area range must match, including non-home projects', () => {
  assert.deepEqual(ids({ areaMin: 130, areaMax: 150, selection: { 3: ['11'], 7: ['26'] } }), [1]);
  assert.deepEqual(ids({ selection: { 3: ['12'], 4: ['16'] } }), [2]);
  assert.deepEqual(ids({ selection: { 1: ['3'] } }), []);
  const houses = [{ id: 9, area: '120 м²', showOnHome: false, parameters: {} }];
  assert.deepEqual(ids({}, houses), [9]);
  assert.deepEqual(ids({ selection: { 3: ['11'] } }, houses), []);
});

test('lead descriptions contain range and selected parameters, without default choices or prices', () => {
  const text = describeProjectFilters(calc, { areaMin: 100, areaMax: 160, selection: { 3: ['11'], 7: [] } });
  assert.match(text, /100–160 м²/);
  assert.match(text, /Стены: Клеёный брус/);
  assert.doesNotMatch(text, /Дополнительно|Фундамент|₽|[Цц]ен|[Сс]тоим/);
});

test('server page, dynamic results, leads and admin settings use the new price-free picker', async (t) => {
  let state = structuredClone(content);
  const savedLeads = [];
  const store = require('../src/data/store');
  const leads = require('../src/data/leadsStore');
  t.mock.method(store, 'getContent', () => structuredClone(state));
  t.mock.method(store, 'saveContent', (value) => { state = structuredClone(value); });
  t.mock.method(leads, 'getLeads', () => []);
  t.mock.method(leads, 'addLead', (lead) => savedLeads.push(lead));
  const express = require('express');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => { req.session = { isAdmin: true }; next(); });
  app.use('/admin', require('../src/routes/admin'));
  app.use('/', require('../src/routes/public'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const query = '?areaMin=98&areaMax=146&block-7=23&block-7=26';
  const page = await fetch(base + '/calculator' + query);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-match-count="1"/);
  assert.match(html, /data-project-id="1"/);
  assert.match(html, /name="areaMin"[^>]*value="98"/);
  assert.match(html, /name="block-7" value="26"[^>]*checked/);
  assert.doesNotMatch(html, /₽|calcTotal|calcPerM2|[Сс]тоимость|[Цц]ена|price|unit|смет/);
  const fragment = await fetch(base + '/calculator/matches' + query);
  assert.equal(fragment.status, 200);
  assert.equal(fragment.headers.get('cache-control'), 'no-store');
  assert.match(await fragment.text(), /data-match-count="1"/);
  const broad = await fetch(base + '/calculator/matches?areaMin=60&areaMax=400');
  assert.match(await broad.text(), /data-project-id="5"/);
  const search = await fetch(base + '/calculator/matches?areaMin=98&areaMax=146&q=' + encodeURIComponent('ГОРИЗОНТ'));
  const searchHtml = await search.text();
  assert.match(searchHtml, /data-match-count="1"/);
  assert.match(searchHtml, /data-project-id="1"/);
  const sorted = await fetch(base + '/calculator/matches?areaMin=98&areaMax=146&sort=area-desc');
  assert.deepEqual([...(await sorted.text()).matchAll(/data-project-id="(\d+)"/g)].map(([, id]) => id), ['1', '3', '2']);
  const empty = await fetch(base + '/calculator/matches?block-1=3');
  assert.match(await empty.text(), /Подходящих проектов пока нет/);

  await fetch(base + '/request', {
    method: 'POST', redirect: 'manual',
    body: new URLSearchParams({
      name: 'Тест', email: 'test@example.com', returnTo: '/calculator',
      calc: JSON.stringify({ areaMin: 98, areaMax: 146, selection: { 7: ['23', '26'] }, price: 1 }),
    }),
  });
  assert.equal(savedLeads.length, 1);
  assert.match(savedLeads[0].details, /98–146 м²/);
  assert.match(savedLeads[0].details, /Дополнительно: Терраса, Тёплые полы/);
  assert.doesNotMatch(savedLeads[0].details, /₽|[Цц]ен|[Сс]тоим/);

  const admin = await fetch(base + '/admin/calculator');
  assert.equal(admin.status, 200);
  assert.doesNotMatch(await admin.text(), /\[price\]|\[unit\]|areaDefault|areaStep|[Цц]ена|[Сс]тоимость/);
  const invalid = await fetch(base + '/admin/calculator/settings', {
    method: 'POST', body: new URLSearchParams({ areaMin: 200, areaMax: 100 }),
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(state.calculator.area, calc.area);
  const saved = await fetch(base + '/admin/calculator/settings', {
    method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ title: 'Подбор проекта', areaMin: 80, areaMax: 180 }),
  });
  assert.equal(saved.status, 302);
  assert.deepEqual(state.calculator.area, { min: 80, max: 180 });

  const directoryUrl = '/admin/calculator/directory';
  const directory = await fetch(base + directoryUrl);
  assert.equal(directory.status, 200);
  assert.match(await directory.text(), /Оцилиндрованный брус/);

  const material = state.calculator.blocks.find((block) => block.id === 3)
    .options.find((option) => option.title === 'Оцилиндрованный брус');
  const edits = new FormData();
  edits.set('title', 'Материал стен дома');
  edits.set('options[0][id]', String(material.id));
  edits.set('options[0][title]', 'Брус для сруба');
  edits.set('options[0][hint]', 'Брёвна одинакового диаметра');
  edits.set('options[0][icon]', 'frame');
  const savedBlock = await fetch(base + '/admin/calculator/blocks/3', {
    method: 'POST', redirect: 'manual', body: edits,
  });
  assert.equal(savedBlock.status, 302);
  assert.equal(savedBlock.headers.get('location'), directoryUrl + '?saved=1#calc-block-3');

  const updated = await (await fetch(base + '/calculator')).text();
  assert.match(updated, /Материал стен дома/);
  assert.match(updated, /Брус для сруба/);
  assert.match(updated, /Брёвна одинакового диаметра/);
  assert.equal(state.calculator.blocks.find((block) => block.id === 3).options[0].icon, 'frame');
});

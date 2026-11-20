const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const ExcelJS = require('exceljs');
const store = require('../src/data/estimatesStore');
const contentStore = require('../src/data/store');
const { itemTotal, formatTotal } = require('../public/js/estimate-totals');

test('estimate rows round to kopecks and accept decimal commas', () => {
  assert.equal(itemTotal({ price: '0,01', quantity: '0,5' }), 1n);
  assert.equal(itemTotal({ price: '12,35', quantity: '2,5' }), 3088n);
  assert.equal(itemTotal({ price: '10', quantity: '-1' }), null);
  assert.equal(itemTotal({ price: '1.001', quantity: '1' }), null);
  assert.equal(formatTotal(-5n), '−0,05 ₽');
});

test('superadmin builds templates and admins fill estimates from a fixed template version', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'top-home-estimates-'));
  const modulePath = path.join(directory, 'estimatesStore.js');
  fs.copyFileSync(require.resolve('../src/data/estimatesStore'), modulePath);
  fs.copyFileSync(require.resolve('../src/data/estimateUnits'), path.join(directory, 'estimateUnits.js'));
  const isolatedStore = require(modulePath);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  t.mock.method(store, 'getEstimates', isolatedStore.getEstimates);
  t.mock.method(store, 'saveEstimate', isolatedStore.saveEstimate);
  t.mock.method(store, 'getEstimateRuns', isolatedStore.getEstimateRuns);
  t.mock.method(store, 'saveEstimateRun', isolatedStore.saveEstimateRun);
  t.mock.method(store, 'getEstimateUnits', isolatedStore.getEstimateUnits);
  t.mock.method(store, 'saveEstimateUnit', isolatedStore.saveEstimateUnit);
  let content = contentStore.getContent();
  content.stages = [
    { id: 2, title: 'Фундамент', photos: [] },
    { id: 3, title: 'Стены', photos: [] },
    { id: 4, title: 'Кровля', photos: [] },
  ];
  t.mock.method(contentStore, 'getContent', () => structuredClone(content));
  t.mock.method(contentStore, 'saveContent', (next) => { content = structuredClone(next); });

  const app = express();
  app.set('view engine', 'ejs');
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.get('x-test-role');
    req.session = { isAdmin: Boolean(role), adminRole: role };
    next();
  });
  app.use('/admin', require('../src/routes/admin'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');

  const base = `http://127.0.0.1:${server.address().port}/admin/estimates`;
  const headers = { 'x-test-role': 'superadmin', 'Content-Type': 'application/json' };
  const unitsUrl = base + '/units';
  const unit = { label: 'Мешок', value: 'меш.' };
  isolatedStore.saveMaterial(undefined, { title: 'Скрытый материал', unit: 'м³', price: '100' });
  const submit = (url, values, requestHeaders = headers) => fetch(url, {
    method: 'POST', redirect: 'manual', headers: requestHeaders, body: JSON.stringify(values),
  });
  const regularAdmin = { ...headers, 'x-test-role': 'admin' };
  assert.equal((await submit(unitsUrl, unit, regularAdmin)).status, 403);
  assert.equal((await submit(unitsUrl, unit)).status, 302);
  assert.equal((await submit(unitsUrl, unit)).status, 400);
  const addedUnit = store.getEstimateUnits().find((entry) => entry.value === unit.value);
  const directoryUrl = new URL('/admin/calculator/directory', base);
  const directoryHtml = await (await fetch(directoryUrl, { headers })).text();
  assert.match(directoryHtml, /Справочник единиц измерений/);
  assert.match(directoryHtml, /class="estimate-unit-list" tabindex="0"/);
  assert.match(directoryHtml, /Мешок/);
  assert.doesNotMatch(directoryHtml, /Материалы для смет|Скрытый материал/);
  assert.doesNotMatch(await (await fetch(directoryUrl, { headers: regularAdmin })).text(), /Справочник единиц измерений/);

  const entry = {
    title: 'Бетон', unit: 'м³', baseCells: ['quantity'], formulas: { price: '=12,35' }, price: '99',
  };
  const draft = {
    title: 'Фундамент <тест>',
    stages: [
      {
        stageId: '2',
        groups: [
          { type: 'work', items: [{
            title: 'Монтаж', unit: 'ч', baseCells: [],
            formulas: { price: '=D4*2', quantity: '=E4+1', amount: '=F4+D7*E7' },
          }] },
          { type: 'material', items: [entry] },
        ],
      },
      {
        stageId: '3',
        groups: [{ type: 'material', items: [] }, { type: 'work', items: [] }],
      },
    ],
  };
  assert.equal((await fetch(base, { redirect: 'manual' })).headers.get('location'), '/admin/login');
  assert.equal((await fetch(base + '/new', { headers: regularAdmin })).status, 403);
  assert.equal((await submit(base, draft, regularAdmin)).status, 403);
  const newEditor = await (await fetch(base + '/new', { headers })).text();
  assert.match(newEditor, /Добавить этап/);
  assert.match(newEditor, /<select data-stage-id required>[\s\S]*?<option value="2">Фундамент<\/option>[\s\S]*?<option value="3">Стены<\/option>/);
  assert.doesNotMatch(newEditor, /data-stage-title/);
  assert.deepEqual([...newEditor.matchAll(/data-base-cell="([^"]+)"/g)].map(([, field]) => field),
    ['price', 'quantity', 'amount']);
  assert.match(newEditor, /data-cell-formula="amount"/);
  assert.doesNotMatch(newEditor, /data-run-entry|Итого по смете/);
  assert.match(newEditor, /<select data-item-field="unit"[\s\S]*?<option value="м²"/);
  assert.match(newEditor, /<option value="м²" data-unit-label="м² — Квадратный метр"/);
  assert.match(newEditor, /<option value="меш\."/);
  assert.doesNotMatch(newEditor, /Скрытый материал/);
  assert.equal((await submit(base, { ...draft, title: '' })).status, 422);
  const [firstStage, secondStage] = draft.stages;
  for (const selection of [{ stageId: 'missing' }, { title: 'Произвольный этап' }]) {
    const rejected = await submit(base, { ...draft, stages: [{ ...selection, groups: [] }] });
    assert.equal(rejected.status, 422);
    assert.match((await rejected.json()).error, /Выберите этап из списка/);
  }
  for (const group of firstStage.groups) {
    const duplicate = { ...firstStage, groups: [...firstStage.groups, group] };
    const rejected = await submit(base, { ...draft, stages: [duplicate, secondStage] });
    assert.equal(rejected.status, 422);
    assert.match((await rejected.json()).error, /подблок «(?:Работы|Материалы)» уже добавлен/);
  }
  assert.deepEqual(store.getEstimates(), []);

  const invalidCells = structuredClone(draft);
  invalidCells.stages[0].groups[1].items[0].baseCells = ['title'];
  assert.equal((await submit(base, invalidCells)).status, 422);

  const invalid = structuredClone(draft);
  invalid.stages[0].groups[0].items[0].formulas.amount = '=F7';
  const invalidTemplate = await submit(base, invalid);
  assert.equal(invalidTemplate.status, 422);
  assert.match((await invalidTemplate.json()).error, /F7/);

  const created = await submit(base, draft);
  assert.equal(created.status, 201);
  const stored = store.getEstimates()[0];
  const duplicateTemplate = await submit(base, { ...draft, title: '  фУНДАМЕНТ   <ТЕСТ> ' });
  assert.equal(duplicateTemplate.status, 409);
  assert.match((await duplicateTemplate.json()).error, /Шаблон с таким названием/);
  assert.deepEqual(stored.stages.map(({ stageId, title }) => ({ stageId, title })), [
    { stageId: '2', title: 'Фундамент' }, { stageId: '3', title: 'Стены' },
  ]);
  assert.deepEqual(stored.stages[0].groups.map((group) => group.type), ['material', 'work']);
  assert.equal(stored.stages[0].groups[0].items[0].title, 'Бетон');
  assert.deepEqual(stored.stages[0].groups[0].items[0].baseCells, ['quantity']);
  assert.deepEqual(stored.stages[0].groups[0].items[0].formulas, { price: '=12,35' });
  assert.equal(stored.stages[0].groups[0].items[0].price, undefined);
  assert.equal(stored.stages[0].groups[0].items[0].quantity, undefined);
  const itemUrl = base + '/' + stored.id;
  const editor = await fetch(itemUrl, { headers });
  assert.equal(editor.status, 200);
  assert.match(await editor.text(), /Фундамент &lt;тест&gt;/);
  const list = await (await fetch(base, { headers })).text();
  assert.doesNotMatch(list, /₽/);
  assert.ok(list.includes('/admin/estimates/' + stored.id));

  const runsUrl = new URL('/admin/estimate-runs', base).href;
  assert.equal((await fetch(runsUrl, { redirect: 'manual' })).headers.get('location'), '/admin/login');
  const runList = await (await fetch(runsUrl, { headers: regularAdmin })).text();
  assert.match(runList, /href="\/admin\/estimate-runs" class="is-active">Расчёт смет/);
  assert.ok(runList.includes('/admin/estimate-runs/new?template=' + stored.id));
  const newRunPage = await fetch(runsUrl + '/new?template=' + stored.id, { headers: regularAdmin });
  assert.equal(newRunPage.status, 200);
  const runEditor = await newRunPage.text();
  assert.match(runEditor, /Шаблон «Фундамент &lt;тест&gt;»/);
  assert.match(runEditor, /Бетон/);
  const runForm = runEditor.match(/<form[^>]*data-estimate-run-form[^>]*>([\s\S]*?)<\/form>/)[1];
  const inputs = [...runForm.matchAll(/<input\b[^>]*>/g)].map(([input]) => input);
  assert.equal(inputs.length, 2);
  assert.match(inputs[0], /data-run-title value="" required/);
  assert.match(inputs[1], /data-run-address="E4"/);
  assert.match(runEditor, /data-run-result="price" data-run-row="4"\s+data-run-address="D4"/);
  assert.match(runEditor, /data-run-result="amount" data-run-row="4"\s+data-run-address="F4"/);
  assert.match(runEditor, /data-run-result="amount" data-run-row="7"\s+data-run-address="F7"/);
  assert.doesNotMatch(runForm, /data-add-stage|data-add-group|data-add-item|data-base-cell/);
  const runDraft = {
    title: '  Фундамент для клиента  ',
    templateId: stored.id, templateRevision: stored.revision,
    entries: { 4: { quantity: '2,5' } },
  };
  assert.equal((await submit(runsUrl, { ...runDraft, templateRevision: 0 }, regularAdmin)).status, 409);
  for (const changes of [
    { title: '  ' },
    { title: undefined },
    { stages: [] },
    { entries: { ...runDraft.entries, 7: { price: '1' } } },
    { entries: { ...runDraft.entries, 99: { price: '1' } } },
    { entries: { 4: { ...runDraft.entries[4], price: '1' } } },
    { entries: { 4: { ...runDraft.entries[4], amount: '1' } } },
    { entries: { 4: { ...runDraft.entries[4], unit: 'шт.' } } },
  ]) {
    assert.equal((await submit(runsUrl, { ...runDraft, ...changes }, regularAdmin)).status, 422);
  }
  assert.deepEqual(store.getEstimateRuns(), []);
  assert.equal((await submit(runsUrl, runDraft, regularAdmin)).status, 201);
  const savedRun = store.getEstimateRuns()[0];
  const duplicateRun = await submit(runsUrl, { ...runDraft, title: ' ФУНДАМЕНТ для  КЛИЕНТА ' }, regularAdmin);
  assert.equal(duplicateRun.status, 409);
  assert.match((await duplicateRun.json()).error, /Расчёт с таким названием/);
  assert.equal(savedRun.title, 'Фундамент для клиента');
  assert.equal(savedRun.totalCents, '14821');
  assert.deepEqual(savedRun.entries[4], { quantity: '2.5' });
  const populatedRunList = await (await fetch(runsUrl, { headers: regularAdmin })).text();
  assert.match(populatedRunList, /Фундамент для клиента/);
  assert.match(populatedRunList, /148,21 ₽/);
  const exportPath = `/admin/estimate-runs/${savedRun.id}/export.xlsx`;
  assert.ok(populatedRunList.includes(exportPath));
  const runPage = await fetch(runsUrl + '/' + savedRun.id, { headers: regularAdmin });
  assert.equal(runPage.status, 200);
  const savedEditor = await runPage.text();
  assert.match(savedEditor, /data-run-title value="Фундамент для клиента"/);
  assert.ok(savedEditor.includes(exportPath));

  const exportUrl = new URL(exportPath, base).href;
  assert.equal((await fetch(exportUrl, { redirect: 'manual' })).headers.get('location'), '/admin/login');
  assert.equal((await fetch(runsUrl + '/unknown/export.xlsx', { headers: regularAdmin })).status, 404);
  const file = await fetch(exportUrl, { headers: regularAdmin });
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(file.headers.get('content-disposition'), /^attachment;.*\.xlsx/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()));
  const sheet = workbook.getWorksheet('Смета');
  assert.equal(sheet.getCell('A1').value, savedRun.title);
  assert.deepEqual(['B6', 'C6', 'D6', 'E6', 'F6'].map((address) => sheet.getCell(address).value),
    ['Бетон', 'м³', 12.35, 2.5, 30.88]);
  assert.equal(sheet.getCell('F7').value, 30.88);
  assert.equal(sheet.getCell('F9').value, 117.33);
  assert.equal(sheet.getCell('F11').value, 148.21);
  assert.equal(sheet.lastRow.getCell(1).value, 'Итого по смете');
  assert.equal(sheet.lastRow.getCell(6).value, 148.21);

  assert.equal((await submit(unitsUrl + '/' + addedUnit.id, { ...unit, label: 'Мешок строительный' })).status, 302);
  const edit = { ...structuredClone(stored), title: 'Новая версия' };
  edit.stages[0].stageId = '4';
  edit.stages[0].groups[0].items[0].unit = 'л';
  edit.stages[0].groups[1].items[0].formulas.amount = '=F4*100';
  assert.equal((await submit(itemUrl, edit)).status, 200);
  assert.equal((await submit(itemUrl, edit)).status, 409);
  assert.equal(store.getEstimates()[0].title, 'Новая версия');
  assert.equal(store.getEstimates()[0].stages[0].title, 'Кровля');
  assert.equal(store.getEstimates()[0].stages[0].groups[0].items[0].unit, 'л');
  const editRun = { title: 'Фундамент — уточнённый расчёт', entries: { 4: { quantity: '3' } }, revision: savedRun.revision };
  const savedRunUrl = runsUrl + '/' + savedRun.id;
  assert.equal((await submit(savedRunUrl, { ...editRun, templateId: stored.id }, regularAdmin)).status, 422);
  assert.equal((await submit(savedRunUrl, { title: savedRun.title, revision: savedRun.revision }, regularAdmin)).status, 422);
  assert.equal((await submit(savedRunUrl, editRun, regularAdmin)).status, 200);
  const updatedRun = store.getEstimateRuns()[0];
  assert.equal(updatedRun.title, editRun.title);
  assert.equal(updatedRun.id, savedRun.id);
  assert.deepEqual(updatedRun.template, savedRun.template);
  assert.equal(updatedRun.totalCents, '17290');
  assert.equal((await submit(runsUrl, runDraft, regularAdmin)).status, 409);

  assert.equal((await submit(base, { title: updatedRun.title, stages: [] })).status, 201);
  const updatedTemplate = store.getEstimates().find((entry) => entry.id === stored.id);
  assert.equal((await submit(runsUrl, {
    ...runDraft, title: updatedTemplate.title, templateRevision: updatedTemplate.revision,
  }, regularAdmin)).status, 201);
  assert.equal((await submit(itemUrl, {
    ...updatedTemplate, title: updatedRun.title,
  })).status, 409);
  assert.equal((await submit(savedRunUrl, {
    ...editRun, revision: updatedRun.revision, title: updatedTemplate.title,
  }, regularAdmin)).status, 409);

  assert.equal(isolatedStore.getMaterials()[0].title, 'Скрытый материал');

  const legacy = {
    title: 'Смета с повторяющимися подблоками',
    stages: [{
      title: 'Кровля',
      groups: [
        { type: 'work', items: [{ title: 'Подготовка', unit: 'ч', price: '20', quantity: '1' }] },
        { type: 'material', items: [{ title: 'Бетон', unit: 'м³', price: '40000', quantity: '1' }] },
        { type: 'work', items: [{ title: 'Укладка', unit: 'ч', price: '30', quantity: '1' }] },
      ],
    }, { title: 'Прежний этап', groups: [] }],
  };
  const { id } = isolatedStore.saveEstimate(undefined, undefined, legacy);
  const legacyPage = await (await fetch(base + '/' + id, { headers })).text();
  const editorState = legacyPage.match(/<textarea data-estimate-data hidden>(.*?)<\/textarea>/s)[1];
  assert.equal(editorState.match(/&#34;type&#34;:&#34;work&#34;/g)?.length, 1);
  assert.match(editorState, /Бетон.*Подготовка.*Укладка/);
  assert.equal(isolatedStore.getEstimates()[0].stages[0].groups.length, 3);
  const legacyTemplate = JSON.parse(editorState.replaceAll('&#34;', '"'));
  assert.equal(legacyTemplate.stages[0].stageId, '4');
  assert.equal(legacyTemplate.stages[1].stageId, undefined);
  const legacyItem = legacyTemplate.stages[0].groups[0].items[0];
  assert.deepEqual(legacyItem.baseCells, ['price', 'quantity', 'amount']);
  assert.equal(legacyItem.price, undefined);
  assert.equal(legacyItem.quantity, undefined);
  assert.equal((await submit(base + '/' + id, legacyTemplate)).status, 200);
  assert.equal(store.getEstimates().find((estimate) => estimate.id === id).stages[1].title, 'Прежний этап');
  const archive = JSON.parse(fs.readFileSync(path.join(directory, 'estimate-archive.json'), 'utf8'));
  assert.equal(archive[0].stages[0].groups[1].items[0].price, '40000');

  const catalog = new URL('/admin/stages', base).href;
  assert.equal((await submit(catalog + '/4/delete', {})).status, 302);
  assert.equal((await submit(catalog, { title: 'Пусконаладка' })).status, 302);
  assert.equal(content.stages.at(-1).id, 5);
  const afterStageDeletion = store.getEstimates().find((estimate) => estimate.id === id);
  assert.equal((await submit(base + '/' + id, afterStageDeletion)).status, 200);
  assert.equal(store.getEstimates().find((estimate) => estimate.id === id).stages[0].title, 'Кровля');

  const previousSnapshot = structuredClone(stored);
  previousSnapshot.stages[0].groups[0].items[0] = { title: 'Бетон', unit: 'м³', base: true };
  previousSnapshot.stages[0].groups[1].items[0] = {
    title: 'Монтаж', unit: 'ч', base: false, formulas: { amount: '=F4/2' },
  };
  const previousRun = isolatedStore.saveEstimateRun(undefined, undefined, {
    title: 'Прежний расчёт', template: previousSnapshot, entries: { 4: { price: '10', quantity: '3' } }, totalCents: '4500',
  });
  const previousRunUrl = runsUrl + '/' + previousRun.id;
  const previousRunHtml = await (await fetch(previousRunUrl, { headers: regularAdmin })).text();
  assert.deepEqual([...previousRunHtml.matchAll(/<input\b[^>]*data-run-address="([^"]+)"/g)]
    .map(([, address]) => address), ['D4', 'E4', 'F4']);
  assert.equal((await submit(previousRunUrl, {
    title: 'Прежний расчёт', revision: 1, entries: { 4: { price: '10', quantity: '3', amount: '40' } },
  }, regularAdmin)).status, 200);
  assert.equal(store.getEstimateRuns().find((run) => run.id === previousRun.id).totalCents, '6000');
});

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
const { buildEstimateWorkbook } = require('../src/utils/estimateWorkbook');
const { referenceProfitSections } = require('../src/utils/estimateReferenceProfitFormulas');
const { getWorksheetRows } = require('../public/js/estimate-formulas');
const { itemTotal, formatTotal } = require('../public/js/estimate-totals');

test('estimate rows round to kopecks and accept decimal commas', () => {
  assert.equal(itemTotal({ price: '0,01', quantity: '0,5' }), 1n);
  assert.equal(itemTotal({ price: '12,35', quantity: '2,5' }), 3088n);
  assert.equal(itemTotal({ price: '10', quantity: '-1' }), null);
  assert.equal(itemTotal({ price: '1.001', quantity: '1' }), null);
  assert.equal(formatTotal(-5n), '−0,05 ₽');
});

test('a configured estimate exports the reference payment and construction appendices with live data', async () => {
  const fixture = [
    ['Фундамент', [60000.05], [80000]],
    ['Стены', [1000, 90000], [70000]],
    ['Кровля', [100000], [120000]],
    ['Окна двери', [75000], [80000]],
    ['Отделка', [125000], [180000]],
    ['Сантехника, электрика, финишные работы.', [90000], [10000, 20000, 30000, 40000, 50000, 60000, 70000]],
    ['Доставка разгрузка', [11000], [12000]],
  ];
  const template = {
    title: 'Шаблон',
    stages: fixture.map(([title, materials, works]) => ({
      title,
      groups: [materials, works].map((prices, index) => ({
        type: index === 0 ? 'material' : 'work',
        items: prices.map((_, itemIndex) => ({
          title: `Позиция ${itemIndex + 1}`,
          unit: 'шт.',
          baseCells: ['price', 'quantity', 'amount'],
        })),
      })),
    })),
  };
  const entries = Object.fromEntries(Array.from(getWorksheetRows(template), ([row, position]) => {
    const { stageIndex, groupIndex, itemIndex } = position;
    const price = fixture[stageIndex][groupIndex + 1][itemIndex];
    return [row, { price: String(price), quantity: '2', amount: String(price * 2) }];
  }));
  // A manual estimate amount must not replace the price × quantity used by the reference formulas.
  entries[4] = { ...entries[4], quantity: '2.5', amount: '0.01' };
  const referencePaymentSchedule = {
    contractLabel: '№ Тест-3',
    contractDate: 45922,
    payments: Array.from({ length: 9 }, (_, index) => ({
      description: `Описание платежа ${index + 1}`,
      amountInWords: `Сумма платежа ${index + 1} прописью`,
    })),
    totalInWords: 'Сумма договора прописью',
  };
  const referenceConstructionSchedule = {
    stages: [0, 1, 2, 3, 4, 6, 5].map((index) => ({
      name: index === 2 ? 'Кровля ' : fixture[index][0],
      amountInWords: `Стоимость этапа ${index + 1} прописью`,
      notes: `Примечание к этапу ${index + 1}`,
    })),
    totalInWords: 'Итого по графику прописью',
  };
  const exported = buildEstimateWorkbook({
    title: 'Расчёт', template, entries, referencePaymentSchedule, referenceConstructionSchedule,
  }, {
    includeAppendices: true,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exported.xlsx.writeBuffer());
  const sheet = workbook.getWorksheet('Приложение№3');
  assert.equal(workbook.getWorksheet('Смета').getCell('F6').value, 0.01);
  assert.equal(sheet.pageSetup.printArea, 'A1:F16');
  assert.equal(sheet.rowCount, 16);
  assert.equal(sheet.columnCount, 6);
  assert.equal(sheet.getCell('D1').master.address, 'A1');
  assert.equal(sheet.getCell('E1').value, referencePaymentSchedule.contractLabel);
  assert.deepEqual(sheet.getCell('F1').value, new Date('2025-09-22T00:00:00Z'));
  assert.equal(sheet.getCell('B2').fill.fgColor.argb, 'FF83A658');
  assert.equal(sheet.getCell('F4').master.address, 'D4');
  assert.equal(sheet.getCell('B4').value, referencePaymentSchedule.payments[0].description);
  assert.equal(sheet.getCell('D12').value, referencePaymentSchedule.payments[8].amountInWords);
  assert.match(sheet.getCell('C4').formula, /'Смета'!\$?D\$?14\*10\+200000/);
  assert.match(sheet.getCell('C5').formula, /SUMPRODUCT\('Смета'!D6:D6,'Смета'!E6:E6\)/);
  assert.match(sheet.getCell('C6').formula, /-C7$/);
  assert.deepEqual([4, 5, 6, 7, 8, 9, 10, 11, 12].map((row) => sheet.getCell(`C${row}`).result),
    [210000, 310000.125, 468000, 30000, 290000, 603000, 540000, 180000, 500340]);
  assert.equal(sheet.getCell('B13').formula, 'SUM(C4:C12)');
  assert.equal(sheet.getCell('B13').result, 3131340.125);
  assert.equal(sheet.getCell('F13').master.address, 'C13');
  assert.equal(sheet.getCell('C13').value, referencePaymentSchedule.totalInWords);
  assert.equal(sheet.getCell('F16').master.address, 'A16');

  const schedule = workbook.getWorksheet('Приложение№4');
  assert.equal(schedule.pageSetup.printArea, 'A1:G13');
  assert.equal(schedule.rowCount, 13);
  assert.equal(schedule.columnCount, 7);
  const mergedCells = ['E1', 'F2', 'F3', 'F9', 'C10', 'G10', 'G11', 'G13'];
  assert.deepEqual(mergedCells.map((address) => schedule.getCell(address).master.address),
    ['A1', 'D2', 'E3', 'E9', 'A10', 'E10', 'A11', 'A13']);
  for (const [address, source] of [['F1', 'E1'], ['G1', 'F1'], ['E3', 'D5'], ['E10', 'C13']]) {
    assert.equal(schedule.getCell(address).formula.replaceAll('$', ''), `'Приложение№3'!${source}`);
    assert.deepEqual(schedule.getCell(address).result, sheet.getCell(source).value);
  }
  const stageRows = [3, 4, 5, 6, 7, 8, 9].map((number) => schedule.getRow(number));
  assert.deepEqual(stageRows.map((row) => row.getCell('B').result),
    referenceConstructionSchedule.stages.map(({ name }) => name));
  assert.deepEqual(stageRows.map((row) => row.getCell('C').formula),
    ['G1+7', 'G1+45', 'G1+60', 'C5+15', 'C6+30', 'C7', 'C7+30']);
  assert.deepEqual(stageRows.map((row) => row.getCell('C').result.toISOString().slice(0, 10)),
    ['2025-09-29', '2025-11-06', '2025-11-21', '2025-12-06', '2026-01-05', '2026-01-05', '2026-02-04']);
  for (const row of stageRows) {
    assert.match(row.getCell('B').formula, /'Смета'!/);
    assert.match(row.getCell('D').formula, /SUMPRODUCT\('Смета'!/);
  }
  assert.deepEqual(stageRows.map((row) => row.getCell('D').result),
    [310000.125, 322000, 440000, 310000, 610000, 46000, 740000]);
  assert.equal(schedule.getCell('D10').formula, 'SUM(D3:D9)');
  assert.equal(schedule.getCell('D10').result, 2778000.125);
  assert.equal(schedule.getCell('E4').value, referenceConstructionSchedule.stages[1].amountInWords);
  assert.equal(schedule.getCell('G9').value, referenceConstructionSchedule.stages[6].notes);
});

test('a configured estimate exports the reference profit sheet without rounding source cost', async () => {
  const stageTitles = [
    'Фундамент', 'Стены', 'Кровля', 'Окна двери', 'Отделка',
    'Сантехника, электрика, финишные работы.', 'Доставка разгрузка',
  ];
  const referenceProfit = { stageLabels: {}, positions: {} };
  const template = {
    title: 'Шаблон',
    stages: referenceProfitSections.map(({ groups }, stageIndex) => {
      const title = stageTitles[stageIndex];
      referenceProfit.stageLabels[groups[0].firstRow] = stageIndex === 2 ? 'Кровля ' : title;
      return {
        title,
        groups: groups.map(({ type, firstRow, lastRow }) => ({
          type,
          items: Array.from({ length: lastRow - firstRow + 1 }, (_, index) => {
            const row = firstRow + index;
            const name = `Позиция ${row} `;
            referenceProfit.positions[row] = { name, unit: 'м3' };
            return { title: name.trim(), unit: 'м³', baseCells: ['price', 'quantity', 'amount'] };
          }),
        })),
      };
    }),
  };
  const entries = Object.fromEntries(Array.from(getWorksheetRows(template).keys(), (row) => [
    row, { price: '10', quantity: '1' },
  ]));
  assert.equal(Object.keys(entries).length, 104);
  entries[4] = { price: '12.35', quantity: '2.555', amount: '0.01' };
  const referencePaymentSchedule = {
    contractLabel: '№ Тест-4 от',
    contractDate: 45922,
    payments: Array.from({ length: 9 }, () => ({ description: 'Платёж', amountInWords: '' })),
    totalInWords: '',
  };
  const exported = buildEstimateWorkbook({
    title: 'Расчёт', template, entries, referenceProfit, referencePaymentSchedule,
  }, { includeAppendices: true });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exported.xlsx.writeBuffer());
  assert.equal(workbook.getWorksheet('Смета').getCell('F6').value, 0.01);

  const profit = workbook.getWorksheet('Прибыль');
  assert.equal(profit.pageSetup.printArea, 'A1:G134');
  assert.equal(profit.rowCount, 134);
  assert.equal(profit.columnCount, 7);
  assert.deepEqual(['D1', 'G1', 'G2', 'C7', 'A11', 'A128', 'G134'].map((address) => profit.getCell(address).master.address),
    ['A1', 'F1', 'C2', 'B7', 'A4', 'A125', 'A134']);

  const displayedValue = (address) => {
    const cell = profit.getCell(address);
    return cell.result ?? cell.value;
  };
  assert.equal(displayedValue('E1'), referencePaymentSchedule.contractLabel);
  assert.deepEqual(displayedValue('F1'), new Date('2025-09-22T00:00:00Z'));
  assert.equal(displayedValue('A26'), 'Кровля ');
  assert.equal(displayedValue('C4'), referenceProfit.positions[4].name);
  assert.equal(displayedValue('D4'), referenceProfit.positions[4].unit);
  assert.match(profit.getCell('E4').formula, /'Смета'!\$?D\$?6\*0\.8/);
  assert.match(profit.getCell('F4').formula, /'Смета'!\$?E\$?6\b/);
  assert.equal(profit.getCell('G4').formula, 'E4*F4');
  assert.equal(profit.getCell('G124').formula, 'SUM(G122:G123)');
  assert.equal(profit.getCell('G129').formula, 'SUM(G125:G128)');
  assert.equal(profit.getCell('G131').formula, 'G124+G129');
  for (const [address, amount] of Object.entries({
    E4: 9.88, F4: 2.555, G4: 25.2434, G7: 41.2434, G11: 57.2434,
    G122: 465.2434, G123: 352, G124: 817.2434, G129: 32, G131: 849.2434,
  })) {
    assert.ok(Math.abs(profit.getCell(address).result - amount) < 1e-8, `${address} should equal ${amount}`);
  }
});

test('superadmin builds templates and admins fill estimates from a fixed template version', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'top-home-estimates-'));
  const isolatedStore = store.createFileEstimatesStore(directory);
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
  app.use(express.urlencoded({ extended: true }));
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
  assert.match(list, /Скопировать шаблон/);
  assert.ok(list.includes(`action="/admin/estimates/${stored.id}/copy"`));

  const runsUrl = new URL('/admin/estimate-runs', base).href;
  assert.equal((await fetch(runsUrl, { redirect: 'manual' })).headers.get('location'), '/admin/login');
  const runList = await (await fetch(runsUrl, { headers: regularAdmin })).text();
  assert.match(runList, /href="\/admin\/estimate-runs" aria-current="page">Расчёт смет/);
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
  const disposition = file.headers.get('content-disposition');
  assert.match(disposition, /^attachment;.*\.xlsx/);
  const filename = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)[1]);
  assert.match(filename, /^Смета — Фундамент для клиента — \d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()));
  const worksheetNames = ['Смета', 'Приложение№3', 'Приложение№4', 'Прибыль'];
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), worksheetNames);
  for (const [name, headerRow] of [['Смета', 3], ['Приложение№3', 6], ['Приложение№4', 5], ['Прибыль', 6]]) {
    const worksheet = workbook.getWorksheet(name);
    const header = worksheet.getRow(headerRow).getCell(2);
    assert.equal(header.fill.fgColor.argb, 'FF83A658');
    assert.equal(header.font.name, 'Tahoma');
    assert.equal(header.border.bottom.color.argb, 'FF000000');
    assert.equal(worksheet.pageSetup.orientation, 'portrait');
  }
  const sheet = workbook.getWorksheet('Смета');
  assert.equal(sheet.getCell('A1').value, savedRun.title);
  assert.deepEqual(['B6', 'C6', 'D6', 'E6', 'F6'].map((address) => sheet.getCell(address).value),
    ['Бетон', 'м³', 12.35, 2.5, 30.88]);
  assert.equal(sheet.getCell('F7').value, 30.88);
  assert.equal(sheet.getCell('F9').value, 117.33);
  assert.equal(sheet.getCell('F11').value, 148.21);
  assert.equal(sheet.lastRow.getCell(1).value, 'Итого по смете');
  const grandTotal = sheet.lastRow.getCell(6);
  assert.equal(grandTotal.value, 148.21);
  assert.equal(grandTotal.fill.fgColor.argb, 'FF83A658');
  assert.equal(grandTotal.numFmt, '#,##0.00" ₽"');

  for (const name of worksheetNames.slice(1)) {
    const formulas = [];
    workbook.getWorksheet(name).eachRow((row) => {
      row.eachCell((cell) => { if (cell.formula) formulas.push(cell.formula); });
    });
    assert.ok(formulas.length > 0, `${name} contains formulas`);
    for (const formula of formulas) {
      assert.doesNotMatch(formula, /#REF!|Приложение№1|\[[^\]]+\.xlsx?\]/);
      for (const [, target] of formula.matchAll(/'([^']+)'!/g)) {
        assert.ok(worksheetNames.includes(target), `Unknown worksheet ${target}`);
      }
    }
  }
  const payments = workbook.getWorksheet('Приложение№3');
  assert.equal(payments.getCell('B2').value, null);
  assert.equal(payments.getCell('G2').value, null);
  assert.equal(payments.getCell('B3').value, 0);
  assert.match(payments.getCell('G3').formula, /'Смета'!\$?F\$?18\b/);
  assert.match(payments.getCell('C8').formula, /'Смета'!\$?F\$?11\b/);
  assert.equal(payments.getCell('E8').result, 148.21);

  const schedule = workbook.getWorksheet('Приложение№4');
  assert.equal(schedule.getCell('B3').value, null);
  assert.equal(schedule.getCell('C6').value, null);
  assert.match(schedule.getCell('G2').formula, /'Приложение№3'!\$?G\$?2\b/);
  assert.match(schedule.getCell('E6').formula, /D6\+C6-1/);
  assert.match(schedule.getCell('F6').formula, /'Смета'!\$?F\$?11\b/);
  assert.equal(schedule.getCell('F6').result, 148.21);

  const profit = workbook.getWorksheet('Прибыль');
  assert.equal(profit.getCell('B3').value, 0.8);
  assert.ok(profit.getColumn(6).values.some((value) => /'Смета'!\$?F\$?6\b/.test(value?.formula || '')));
  assert.equal(profit.lastRow.getCell(7).result, 118.56);
  assert.equal(profit.lastRow.getCell(8).result, 29.65);

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

  const original = store.getEstimates().find((estimate) => estimate.id === stored.id);
  const copyUrl = itemUrl + '/copy';
  const copyTemplate = (url, title, role = 'superadmin') => fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: role ? { 'x-test-role': role } : undefined,
    body: new URLSearchParams({ title }),
  });
  const templateCount = store.getEstimates().length;
  const deniedCopy = await copyTemplate(copyUrl, 'Копия сметы', '');
  assert.equal(deniedCopy.headers.get('location'), '/admin/login');
  assert.equal((await copyTemplate(copyUrl, 'Копия сметы', 'admin')).status, 403);
  assert.equal((await copyTemplate(base + '/missing/copy', 'Копия сметы')).status, 404);
  const blankCopy = await copyTemplate(copyUrl, '   ');
  assert.equal(blankCopy.status, 422);
  assert.match(await blankCopy.text(), /Заполните поле «Название копии»/);
  const duplicateCopy = await copyTemplate(copyUrl, '  нОВАЯ   ВЕРСИЯ ');
  assert.equal(duplicateCopy.status, 409);
  assert.match(await duplicateCopy.text(), /Шаблон с таким названием/);
  assert.equal(store.getEstimates().length, templateCount);

  const copyResponse = await copyTemplate(copyUrl, '  Копия сметы  ');
  assert.equal(copyResponse.status, 303);
  const copied = store.getEstimates().find((estimate) => estimate.title === 'Копия сметы');
  assert.ok(copied);
  assert.notEqual(copied.id, original.id);
  assert.equal(copied.revision, 1);
  assert.equal(copied.isTemplate, true);
  assert.deepEqual(copied.stages, original.stages);
  assert.equal(copyResponse.headers.get('location'), `/admin/estimates/${copied.id}?saved=1`);
  assert.equal(store.getEstimates().length, templateCount + 1);

  const copyEditor = await fetch(new URL(copyResponse.headers.get('location'), base), { headers });
  assert.equal(copyEditor.status, 200);
  assert.match(await copyEditor.text(), /Копия сметы/);
  const copyEdit = structuredClone(copied);
  copyEdit.stages[0].groups[0].items[0].formulas.price = '=20';
  assert.equal((await submit(base + '/' + copied.id, copyEdit)).status, 200);
  const savedCopy = store.getEstimates().find((estimate) => estimate.id === copied.id);
  assert.equal(savedCopy.stages[0].groups[0].items[0].formulas.price, '=20');
  assert.deepEqual(store.getEstimates().find((estimate) => estimate.id === original.id), original);
});

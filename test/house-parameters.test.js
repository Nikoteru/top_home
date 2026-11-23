const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { normalizeHouseParameters, getHouseParameterFields, getHouseSpecs } = require('../src/utils/houseParameters');
const { getProjectPresentationDetails } = require('../src/utils/projectPresentation');
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

test('project PDF details preserve additional fields independently of selected parameters', () => {
  const calculator = { blocks: [
    { id: 1, title: 'Стены', options: [{ id: 10, title: 'Клеёный брус' }] },
    { id: 2, title: 'Кровля', options: [{ id: 20, title: 'Металлочерепица' }] },
    { id: 3, title: 'Дополнительно', multiple: true, options: [
      { id: 30, title: 'Терраса' }, { id: 31, title: 'Септик' },
    ] },
  ] };
  const house = {
    area: '146 м²',
    price: 0,
    description: 'Короткий текст проекта',
    fullDescription: 'Развёрнутый текст проекта',
    parameters: { 1: ['10'], 2: [], 3: ['30', '31'] },
    specs: [
      { label: 'Материал стен', value: 'Отдельная характеристика стен' },
      { label: 'Кровля', value: 'Ручное описание кровли' },
      { label: 'Площадь', value: '124 м² без террасы' },
      { label: 'Предусмотрено остекление', value: '' },
      { label: 'Количество ступеней', value: 0 },
      { label: 'Планировка', value: 'Не указано' },
      { label: '  ', value: '  ' },
    ],
  };

  const details = getProjectPresentationDetails(house, calculator);
  assert.deepEqual(details.summary.map(({ value }) => value), ['146 м²', '0']);
  assert.deepEqual(details.descriptions.map(({ value }) => value), [house.description, house.fullDescription]);
  assert.deepEqual(details.parameters, [
    { label: 'Стены', value: 'Клеёный брус' },
    { label: 'Дополнительно', value: 'Терраса, Септик' },
  ]);
  assert.deepEqual(details.additional, house.specs.slice(0, -1).map((spec) => ({ ...spec, value: String(spec.value) })));
});

test('admin forms save and clear multipart selections, and calculator deletion cleans references', async (t) => {
  let state = structuredClone(content);
  delete state.houses[0].inclusions;
  delete state.houses[1].inclusions;
  state.stages = [
    { id: 1, title: 'Фундамент', photos: [] },
    { id: 2, title: 'Стены', photos: [] },
    { id: 3, title: 'Кровля', photos: [] },
  ];
  const otherProject = structuredClone(state.houses[1]);
  state.houses[0].image = '/images/placeholder-1.svg';
  const examplePhoto = '/images/gallery-1-1.svg';
  state.houses[0].gallery = [examplePhoto, '/uploads/missing-presentation-image.jpg'];
  state.houses[0].showOnHome = true;
  const store = require('../src/data/store');
  const leads = require('../src/data/leadsStore');
  const estimates = require('../src/data/estimatesStore');
  const estimateRun = {
    id: 'foundation-estimate',
    title: 'Смета фундамента',
    template: {
      title: 'Фундамент',
      stages: [{
        title: 'Основание',
        groups: [{ type: 'material', items: [{ title: 'Арматура', unit: 'шт.', baseCells: ['price', 'quantity'] }] }],
      }],
    },
    entries: { 4: { price: '13.50', quantity: '2' } },
  };
  let availableRuns = [estimateRun];
  t.mock.method(store, 'getContent', () => structuredClone(state));
  t.mock.method(store, 'saveContent', (updated) => { state = structuredClone(updated); });
  t.mock.method(leads, 'getLeads', () => []);
  t.mock.method(estimates, 'getEstimateRuns', () => availableRuns);
  const express = require('express');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
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
  const adminHeaders = { 'x-test-admin': '1' };

  const cardCover = /<a href="\/houses\/1" class="house-card__image"[^>]*>\s*<img src="([^"]+)"/;
  const coverPages = [
    ['/admin/houses', /<img\b(?=[^>]*\bclass="[^"]*\badmin-preview--house\b)[^>]*\bsrc="([^"]+)"/],
    ['/', cardCover],
    ['/projects', cardCover],
    ['/houses/1', /id="galleryMain"[^>]*>\s*<img src="([^"]+)"/],
    ['/calculator/matches', /<article class="calc-project" data-project-id="1">\s*<a[^>]*>\s*<span class="calc-project__image"><img src="([^"]+)"/],
  ];
  async function assertProjectCover(expected, expectedGallery) {
    await Promise.all(coverPages.map(async ([route, pattern]) => {
      const response = await fetch(base + route, { headers: adminHeaders });
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.equal(html.match(pattern)?.[1], expected, route);
      if (route === '/houses/1') {
        const gallery = html.match(/window\.HOUSE_GALLERY = ([^\r\n]+);/)?.[1];
        assert.deepEqual(JSON.parse(gallery), expectedGallery);
        assert.match(html, /data-gallery-step="-1"/);
        assert.match(html, /data-gallery-step="1"/);
        assert.match(html, /data-caption="Пример изображения"/);
      }
    }));
  }

  const firstHouse = state.houses[0];
  const savedCover = firstHouse.image;
  const savedGallery = firstHouse.gallery;
  const demoCover = '/images/site/horizon.webp';
  const galleryPhoto = '/images/site/panorama.webp';
  const chosenCover = '/images/site/compact.webp';
  await assertProjectCover(demoCover, [demoCover, examplePhoto]);
  firstHouse.gallery = [...savedGallery, galleryPhoto];
  await assertProjectCover(galleryPhoto, [galleryPhoto, examplePhoto]);
  firstHouse.image = chosenCover;
  firstHouse.gallery.push(chosenCover, galleryPhoto);
  await assertProjectCover(chosenCover, [chosenCover, galleryPhoto, examplePhoto]);
  firstHouse.image = savedCover;
  firstHouse.gallery = savedGallery;

  async function submit(route, entries, authenticated = true, status = 302) {
    const body = new FormData();
    for (const [key, value] of entries) body.append(key, value);
    const response = await fetch(base + route, {
      method: 'POST', body, redirect: 'manual', headers: { 'x-test-admin': authenticated ? '1' : '0' },
    });
    assert.equal(response.status, status, await response.text());
    return response;
  }
  const linkEstimate = (estimateRunId, authenticated = true) => fetch(base + '/admin/house/1/estimate', {
    method: 'POST',
    body: new URLSearchParams({ estimateRunId }),
    redirect: 'manual',
    headers: { 'x-test-admin': authenticated ? '1' : '0' },
  });
  const inclusionsUrl = base + '/admin/house/1/inclusions';
  const saveInclusions = (inclusions, headers = adminHeaders) => fetch(inclusionsUrl, {
    method: 'POST', redirect: 'manual', body: JSON.stringify(inclusions),
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
  const updateStage = (path, fields) => fetch(base + `/admin/stages/${path}`, {
    method: 'POST', redirect: 'manual', headers: adminHeaders, body: new URLSearchParams(fields),
  });

  const denied = await submit('/admin/house/1', [['parametersPresent', '1']], false);
  assert.equal(denied.headers.get('location'), '/admin/login');
  assert.deepEqual(state.houses[0].parameters, content.houses[0].parameters);
  assert.equal((await linkEstimate(estimateRun.id, false)).headers.get('location'), '/admin/login');
  assert.equal((await fetch(inclusionsUrl, { redirect: 'manual' })).headers.get('location'), '/admin/login');

  const inclusions = {
    title: 'Что входит в стоимость этого дома',
    note: 'Условия комплектации этого проекта',
    sections: [
      { stageId: '2', items: [{ title: 'Монтаж стен', description: 'Подробности стенового комплекта' }] },
      { stageId: '1', items: [
        { title: 'Монтаж плиты', description: 'Подготовка площадки\n• Армирование\n<em>Проверка</em>' },
        { title: 'Приёмка', description: 'Проверка геометрии' },
      ] },
    ],
  };
  const expectedInclusions = {
    ...inclusions,
    sections: [
      { ...inclusions.sections[1], title: 'Фундамент' },
      { ...inclusions.sections[0], title: 'Стены' },
    ],
  };
  assert.equal((await saveInclusions(inclusions, {})).headers.get('location'), '/admin/login');
  const initialInclusions = await fetch(inclusionsUrl, { headers: adminHeaders });
  assert.equal(initialInclusions.status, 200);
  const editorHtml = await initialInclusions.text();
  assert.match(editorHtml, /data-inclusion-stage="1"/);
  assert.match(editorHtml, /data-inclusion-stage="3"/);
  assert.match(editorHtml, /data-add-item/);
  assert.doesNotMatch(editorHtml, /data-add-section/);
  assert.doesNotMatch(await (await fetch(base + '/houses/1')).text(), /id="house-inclusions"/);
  const savedInclusions = await saveInclusions(inclusions);
  assert.equal(savedInclusions.status, 200);
  assert.deepEqual(await savedInclusions.json(), { url: '/admin/house/1/inclusions?saved=1' });
  assert.deepEqual(state.houses[0].inclusions, expectedInclusions);
  assert.equal((await saveInclusions({ ...inclusions, sections: [{ stageId: '999', items: [] }] })).status, 422);
  assert.equal((await saveInclusions({ ...inclusions, sections: [inclusions.sections[0], inclusions.sections[0]] })).status, 422);
  const missingDescription = await saveInclusions({
    ...inclusions, sections: [{ stageId: '1', items: [{ title: 'Новый пункт', description: '  ' }] }],
  });
  assert.equal(missingDescription.status, 422);
  assert.match((await missingDescription.json()).error, /Заполните описание/);
  assert.deepEqual(state.houses[0].inclusions, expectedInclusions);
  const savedInclusionsPage = await fetch(inclusionsUrl + '?saved=1', { headers: adminHeaders });
  const savedInclusionsHtml = await savedInclusionsPage.text();
  assert.match(savedInclusionsHtml, /Комплектация сохранена/);
  assert.match(savedInclusionsHtml, /data-inclusion-data hidden/);
  assert.match(savedInclusionsHtml, /Приёмка/);

  await submit('/admin/house/1', [
    ['parametersPresent', '1'], ['area', '210 м²'],
    ['parameters[1]', '3'], ['parameters[2]', '5'], ['parameters[3]', '12'],
    ['parameters[4]', '15'], ['parameters[5]', '19'], ['parameters[6]', '22'],
    ['parameters[7][]', '23'], ['parameters[7][]', '29'], ['parameters[7][]', '999'],
  ]);
  assert.deepEqual(state.houses[0].parameters[3], ['12']);
  assert.deepEqual(state.houses[0].parameters[7], ['23', '29']);
  const beforeLink = structuredClone(state.houses[0]);
  assert.equal((await linkEstimate('missing')).status, 400);
  assert.deepEqual(state.houses[0], beforeLink);
  const linked = await linkEstimate(estimateRun.id);
  assert.equal(linked.status, 302);
  assert.equal(linked.headers.get('location'), '/admin/houses?saved=1&open=1');
  assert.deepEqual(state.houses[0], { ...beforeLink, estimateRunId: estimateRun.id });
  assert.deepEqual(state.houses[1], otherProject);
  const page = await fetch(base + '/houses/1');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /210 м²/);
  assert.match(html, /Терраса, Септик/);
  assert.doesNotMatch(html, /Смета фундамента|foundation-estimate/);
  assert.match(html, /id="house-inclusions-title">Что входит в стоимость этого дома/);
  assert.match(html, /aria-controls="inclusion-panel-1" data-inclusion-tab/);
  assert.match(html, /house-inclusions__stage-title">Фундамент[\s\S]*?house-inclusions__stage-title">Стены/);
  assert.doesNotMatch(html, /house-inclusions__stage-title">Кровля/);
  assert.match(html, /<summary><span>1\. Монтаж плиты<\/span><\/summary>/);
  assert.match(html, /Подготовка площадки\n• Армирование\n&lt;em&gt;Проверка&lt;\/em&gt;/);
  assert.match(html, /<summary><span>2\. Приёмка<\/span><\/summary>/);
  assert.match(html, /Условия комплектации этого проекта/);
  assert.doesNotMatch(await (await fetch(base + '/houses/2')).text(), /id="house-inclusions"/);
  const adminPage = await fetch(base + '/admin/houses', { headers: adminHeaders });
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert.ok(adminHtml.includes('href="/admin/house/1/inclusions"'));
  const form = adminHtml.split('action="/admin/house/1"')[1].split('</form>')[0];
  assert.match(form, /name="parameters\[3\]"[\s\S]*?value="12" selected/);
  assert.match(form, /name="parameters\[7\]\[\]" value="29" checked/);
  assert.doesNotMatch(form, /name="estimateRunId"/);
  assert.ok(adminHtml.indexOf('action="/admin/house/1/estimate"') < adminHtml.indexOf('action="/admin/house/1"'));
  const estimateForm = adminHtml.split('action="/admin/house/1/estimate"')[1].split('</form>')[0];
  assert.match(estimateForm, /name="estimateRunId"[\s\S]*?value="foundation-estimate" selected>Смета фундамента/);
  assert.match(estimateForm, /Закрепить расчёт/);
  assert.match(estimateForm, /href="\/admin\/estimate-runs\/foundation-estimate"/);
  const archivePath = '/admin/house/1/presentation.zip';
  assert.ok(adminHtml.includes(`href="${archivePath}"`));
  assert.equal((await fetch(base + archivePath, { redirect: 'manual' })).headers.get('location'), '/admin/login');
  assert.equal((await fetch(base + '/admin/house/unknown/presentation.zip', { headers: adminHeaders })).status, 404);

  const presentation = await fetch(base + archivePath, { headers: adminHeaders });
  assert.equal(presentation.status, 200);
  assert.match(presentation.headers.get('content-type'), /application\/zip/);
  assert.match(presentation.headers.get('content-disposition'), /^attachment;.*\.zip/);
  const archive = await JSZip.loadAsync(await presentation.arrayBuffer());
  assert.deepEqual(Object.keys(archive.files).sort(), ['Презентация.pdf', 'Смета.xlsx']);
  const pdf = await archive.file('Презентация.pdf').async('nodebuffer');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const pdfObjects = pdf.toString('latin1');
  assert.match(pdfObjects, /\/ToUnicode\b/);
  assert.equal([...pdfObjects.matchAll(/\/Subtype \/Image\b/g)].length, 2);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await archive.file('Смета.xlsx').async('nodebuffer'));
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ['Смета']);
  const sheet = workbook.getWorksheet('Смета');
  assert.equal(sheet.getCell('A1').value, estimateRun.title);
  assert.equal(sheet.lastRow.getCell(6).value, 27);

  const originalHouse = structuredClone(state.houses[0]);
  await submit('/admin/house/1', [['estimateRunId', 'missing'], ['title', 'Изменённый дом']], true, 400);
  assert.deepEqual(state.houses[0], originalHouse);

  await submit('/admin/house/1', [['parametersPresent', '1']]);
  assert.ok(Object.values(state.houses[0].parameters).every((ids) => ids.length === 0));
  assert.deepEqual(state.houses[0].specs, content.houses[0].specs);
  assert.equal(state.houses[0].estimateRunId, estimateRun.id);

  const created = await submit('/admin/house', [
    ['title', 'Тестовый проект'], ['parametersPresent', '1'],
    ['parameters[1]', '2'], ['parameters[7][]', '25'], ['estimateRunId', estimateRun.id],
  ]);
  const house = state.houses.at(-1);
  assert.deepEqual(house.parameters[1], ['2']);
  assert.deepEqual(house.parameters[7], ['25']);
  assert.equal(house.estimateRunId, estimateRun.id);
  assert.match(created.headers.get('location'), new RegExp(`open=${house.id}$`));
  assert.equal((await linkEstimate('')).status, 302);
  assert.equal(state.houses[0].estimateRunId, undefined);
  assert.equal(state.houses.at(-1).estimateRunId, estimateRun.id);
  const unlinkedPresentation = await fetch(base + archivePath, { headers: adminHeaders });
  assert.equal(unlinkedPresentation.status, 200);
  const unlinkedArchive = await JSZip.loadAsync(await unlinkedPresentation.arrayBuffer());
  assert.deepEqual(Object.keys(unlinkedArchive.files), ['Презентация.pdf']);

  delete state.houses[0].inclusions.sections[1].stageId;
  assert.equal((await updateStage('2', { title: 'Стены дома' })).status, 302);
  assert.equal(state.houses[0].inclusions.sections[1].stageId, '2');
  assert.equal((await updateStage('2/move', { direction: 'up' })).status, 302);
  const reordered = await (await fetch(base + '/houses/1')).text();
  assert.match(reordered, /house-inclusions__stage-title">Стены дома[\s\S]*?house-inclusions__stage-title">Фундамент/);
  assert.match(reordered, /Монтаж стен/);

  assert.equal((await updateStage('2/delete')).status, 302);
  assert.doesNotMatch(await (await fetch(base + '/houses/1')).text(), /Монтаж стен/);
  const unassigned = await (await fetch(inclusionsUrl, { headers: adminHeaders })).text();
  assert.match(unassigned, /Пункты без этапа[\s\S]*?Стены дома[\s\S]*?data-inclusion-assignment="1"/);
  assert.equal((await saveInclusions({ ...inclusions, sections: [inclusions.sections[1]], assignments: { 1: '3' } })).status, 200);
  const reassigned = await (await fetch(base + '/houses/1')).text();
  assert.match(reassigned, /house-inclusions__stage-title">Кровля[\s\S]*?Монтаж стен/);
  assert.equal(state.houses[0].inclusions.sections[1].stageId, '3');

  assert.equal((await saveInclusions({ ...inclusions, sections: [] })).status, 200);
  assert.doesNotMatch(await (await fetch(base + '/houses/1')).text(), /id="house-inclusions"/);

  await submit('/admin/calculator/blocks/1', [
    ['title', 'Этажность'], ['options[0][id]', '2'], ['options[0][remove]', '1'],
  ]);
  assert.deepEqual(state.houses.at(-1).parameters[1], []);
  await submit('/admin/calculator/blocks/7/delete', []);
  assert.ok(state.houses.every((item) => !Object.hasOwn(item.parameters, 7)));

  availableRuns = [];
  const emptyProjects = await (await fetch(base + '/admin/houses', { headers: adminHeaders })).text();
  const emptyLinkSection = emptyProjects.split('id="house-estimate-1"')[1].split('</section>')[0];
  assert.match(emptyLinkSection, /Привязка расчёта сметы/);
  assert.match(emptyLinkSection, /href="\/admin\/estimate-runs"/);
  assert.doesNotMatch(emptyLinkSection, /name="estimateRunId"/);
  assert.equal((await fetch(base + `/admin/house/${house.id}/presentation.zip`, { headers: adminHeaders })).status, 409);
});

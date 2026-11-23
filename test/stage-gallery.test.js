const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const content = require('../src/data/content.json');
const store = require('../src/data/store');
const leads = require('../src/data/leadsStore');

test('the admin stage preview matches the public gallery and keeps the stored deletion indices', async (t) => {
  const missingUpload = '/uploads/stage-gallery-test-missing-upload.webp';
  const stages = [
    {
      id: 1,
      title: 'Подготовка к строительству',
      photos: [
        '/images/stages/stage-1-2.svg',
        '/images/site/horizon.webp',
        missingUpload,
        '/images/stages/stage-1-1.svg',
        '/images/site/minimal.webp',
        '/images/site/horizon.webp',
      ],
    },
    { id: 2, title: 'Фундамент', photos: [] },
    { id: 3, title: 'Стены', photos: [missingUpload, '/images/stages/stage-3-1.svg'] },
    { id: 5, title: 'Перегородки', photos: ['/images/stages/stage-5-2.svg'] },
  ];
  const savedStages = structuredClone(stages);
  t.mock.method(store, 'getContent', () => ({ ...content, stages }));
  t.mock.method(store, 'saveContent', () => {});
  t.mock.method(leads, 'getLeads', () => []);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/admin', (req, res, next) => {
    req.session = { isAdmin: true };
    next();
  }, require('../src/routes/admin'));
  app.use('/', require('../src/routes/public'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');

  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/stages`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const galleries = [...html.matchAll(/data-stage-gallery="([^"]+)">([\s\S]*?)<\/div>/g)]
    .map(([, escaped, thumbnails]) => {
      const slideshow = JSON.parse(escaped.replaceAll('&#34;', '"'));
      const previews = [...thumbnails.matchAll(/<img src="([^"]+)"/g)].map(([, src]) => src);
      assert.deepEqual(previews, slideshow);
      return slideshow;
    });

  assert.deepEqual(galleries, [
    [
      '/images/site/horizon.webp',
      '/images/site/minimal.webp',
      '/images/site/horizon.webp',
      '/images/stages/illustrations/stage-1.webp',
      '/images/stages/stage-1-2.svg',
      '/images/stages/stage-1-1.svg',
    ],
    ['/images/stages/illustrations/stage-3.webp', '/images/stages/stage-3-1.svg'],
    ['/images/stages/stage-5-2.svg'],
  ]);
  assert.match(html, />Иллюстрация</);
  assert.match(html, />Пример</);
  assert.ok(!html.includes(missingUpload));

  const adminResponse = await fetch(`${base}/admin/stages`);
  assert.equal(adminResponse.status, 200);
  const adminHtml = await adminResponse.text();
  const adminCards = adminHtml.split('<details class="admin-stage"').slice(1);
  const adminGalleries = adminCards.map((card) => [...card.matchAll(/<img src="([^"]+)"/g)].map(([, src]) => src));
  assert.deepEqual(adminGalleries, [galleries[0], [], galleries[1], galleries[2]]);

  const removalIndices = [...adminCards[0].matchAll(/action="\/admin\/stages\/1\/photos\/(\d+)\/delete"/g)]
    .map(([, index]) => Number(index));
  assert.deepEqual(removalIndices, [1, 4, 5, 0, 3, 2]);
  assert.match(adminCards[0], /Недоступные файлы \(1\)/);
  assert.match(adminCards[0], /href="\/stages#stage-1"/);
  assert.match(adminCards[0], />Иллюстрация</);
  assert.match(adminCards[0], />Пример</);
  assert.deepEqual(stages, savedStages);

  const removal = await fetch(`${base}/admin/stages/1/photos/5/delete`, { method: 'POST', redirect: 'manual' });
  assert.equal(removal.status, 302);
  assert.deepEqual(stages[0].photos, savedStages[0].photos.slice(0, -1));
});

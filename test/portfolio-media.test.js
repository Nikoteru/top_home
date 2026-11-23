const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const store = require('../src/data/store');
const leadsStore = require('../src/data/leadsStore');

test('portfolio shows the published cover in admin and keeps the stored photo indices in its forms', async (t) => {
  const state = store.getContent();
  const illustration = '/images/site/horizon.webp';
  const cover = '/images/site/minimal.webp';
  const nextCover = '/images/site/panorama.webp';
  const sample = '/images/gallery-4-1.svg';
  const missing = '/uploads/portfolio-media-test-missing.webp';
  state.portfolio = [
    { id: 1, title: 'Объект с визуализацией', photos: ['/images/gallery-1-1.svg'] },
    { id: 2, title: 'Объект с фотографиями', photos: [sample, missing, cover, nextCover] },
  ];
  t.mock.method(store, 'getContent', () => structuredClone(state));
  t.mock.method(store, 'saveContent', (updated) => { state.portfolio = updated.portfolio; });
  t.mock.method(leadsStore, 'getLeads', () => []);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use((req, res, next) => {
    req.session = { isAdmin: true };
    next();
  });
  app.use('/admin', require('../src/routes/admin'));
  app.use('/', require('../src/routes/public'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function html(url) {
    const response = await fetch(origin + url);
    assert.equal(response.status, 200, url);
    return response.text();
  }

  const admin = await html('/admin/portfolio');
  const adminCovers = [...admin.matchAll(/class="admin-preview admin-preview--house" src="([^"]+)"/g)]
    .map(([, src]) => src);
  assert.deepEqual(adminCovers, [illustration, cover]);
  assert.match(admin, /Обложка на сайте · Визуализация/);
  assert.ok(admin.includes(`src="${cover}" alt="Фото 1"`));
  assert.ok(admin.includes(`src="${nextCover}" alt="Фото 2"`));
  assert.ok(!admin.includes(`src="${sample}"`));
  assert.ok(admin.includes('/admin/portfolio/2/photos/3/cover'));
  assert.ok(admin.includes('/admin/portfolio/2/photos/0/delete'));

  const publicPortfolio = await html('/portfolio');
  assert.ok(publicPortfolio.includes(`src="${illustration}"`));
  assert.ok(publicPortfolio.includes(`src="${cover}"`));

  const setCover = await fetch(origin + '/admin/portfolio/2/photos/3/cover', { method: 'POST', redirect: 'manual' });
  assert.equal(setCover.status, 302);
  assert.deepEqual(state.portfolio[1].photos, [nextCover, sample, missing, cover]);
  const detail = await html('/portfolio/2');
  assert.ok(detail.includes(`src="${nextCover}" alt="" fetchpriority="high"`));
  assert.ok((await html('/admin/portfolio')).includes(`class="admin-preview admin-preview--house" src="${nextCover}"`));
});

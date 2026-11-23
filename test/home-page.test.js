const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const store = require('../src/data/store');
const leadsStore = require('../src/data/leadsStore');

test('the homepage editor shows the published selections and saves the design block', async (t) => {
  const photos = {
    hero: '/images/site/hero.webp',
    project: '/images/site/horizon.webp',
    stage: '/images/stages/illustrations/stage-1.webp',
    portfolio: '/images/site/minimal.webp',
    design: '/images/individual-studio.webp',
    missing: '/uploads/home-page-test-missing.webp',
  };
  let state = {
    ...store.getContent(),
    hero: { title: 'Баннер сайта', image: '/images/placeholder-hero.svg' },
    houses: [
      { id: 1, title: 'Проект на главной', image: '/images/placeholder-1.svg' },
      { id: 2, title: 'Проект только в каталоге', showOnHome: false },
    ],
    stages: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1, title: `Проверочный этап ${index + 1}`, photos: ['/images/stages/stage-1-1.svg'],
    })),
    portfolio: Array.from({ length: 4 }, (_, index) => ({
      id: index + 1, title: `Проверочный объект ${index + 1}`, photos: [photos.missing, photos.portfolio],
    })),
    advantages: [{ id: 1, title: 'Преимущество без фото', image: photos.missing }],
    homeDesign: undefined,
  };
  t.mock.method(store, 'getContent', () => structuredClone(state));
  t.mock.method(store, 'saveContent', (next) => { state = next; });
  t.mock.method(leadsStore, 'getLeads', () => []);

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
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function render(url) {
    const response = await fetch(origin + url);
    assert.equal(response.status, 200, url);
    return response.text();
  }

  let [homepage, admin] = await Promise.all([render('/'), render('/admin/home')]);
  assert.match(admin, /<iframe class="admin-public-preview__frame" src="\/"/);
  assert.ok(homepage.includes(`class="hero-media" src="${photos.hero}"`));
  assert.ok(admin.includes(`class="admin-preview" src="${photos.hero}"`));
  for (const page of [homepage, admin]) {
    for (const photo of [photos.project, photos.stage, photos.portfolio, photos.design]) {
      assert.ok(page.includes(`src="${photo}"`));
    }
    for (const title of ['Проект на главной', 'Проверочный этап 4', 'Проверочный объект 3']) {
      assert.ok(page.includes(title));
    }
    for (const hidden of [photos.missing, 'Проект только в каталоге', 'Проверочный этап 5', 'Проверочный объект 4']) {
      assert.ok(!page.includes(hidden));
    }
  }

  const heroForm = new FormData();
  heroForm.set('title', 'Новый заголовок баннера');
  const heroUpdate = await fetch(origin + '/admin/hero', { method: 'POST', body: heroForm, redirect: 'manual' });
  assert.equal(heroUpdate.status, 302);

  const designForm = new FormData();
  designForm.set('text', 'Новое описание проектирования');
  const designUpdate = await fetch(origin + '/admin/home/design', { method: 'POST', body: designForm, redirect: 'manual' });
  assert.equal(designUpdate.headers.get('location'), '/admin/home?saved=1');
  assert.equal(state.homeDesign.text, 'Новое описание проектирования');

  [homepage, admin] = await Promise.all([render('/'), render('/admin/home?saved=1')]);
  for (const page of [homepage, admin]) {
    assert.ok(page.includes('Новый заголовок баннера'));
    assert.ok(page.includes('Новое описание проектирования'));
    assert.ok(page.includes(`src="${photos.design}"`));
  }
});

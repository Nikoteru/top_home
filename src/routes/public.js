const express = require('express');
const rateLimit = require('express-rate-limit');
const { getContent } = require('../data/store');
const { addLead } = require('../data/leadsStore');
const { isValidRuPhone, isValidEmail, formatRuPhone } = require('../utils/validate');
const { getAreaLimits, normalizeProjectFilters, matchProjects, describeProjectFilters } = require('../utils/projectMatcher');
const { ICONS } = require('../data/calcIcons');
const { getHouseSpecs } = require('../utils/houseParameters');

// В заявку попадают диапазон площади и существующие варианты параметров.
function calcDetailsFromRequest(raw, content) {
  if (!raw || typeof raw !== 'string' || raw.length > 4000 || !content.calculator) return '';
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return '';
    return describeProjectFilters(content.calculator, data);
  } catch (e) {
    return '';
  }
}

const router = express.Router();

// Ограничиваем частоту отправки заявок с одного IP — форма публичная,
// без этого её легко завалить спамом.
const requestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много заявок подряд. Попробуйте снова через несколько минут.' },
});

router.get('/', (req, res) => {
  const content = getContent();
  // На главную попадают только дома с галочкой «Показывать на главной».
  // У старых записей поля нет — считаем их показанными, как было раньше.
  const homeHouses = content.houses.filter((h) => h.showOnHome !== false);
  res.render('index', {
    content,
    homeHouses,
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
});

// Вытаскиваем число из строк вида "от 6 200 000 ₽" или "146 м²" для сортировки.
// Если числа нет, возвращаем null — такие проекты уходят в конец списка.
function toNumber(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

const PROJECT_SORTS = {
  default: { label: 'По умолчанию' },
  'price-asc': { label: 'Сначала дешевле', field: 'price', dir: 1 },
  'price-desc': { label: 'Сначала дороже', field: 'price', dir: -1 },
  'area-asc': { label: 'Площадь ↑', field: 'area', dir: 1 },
  'area-desc': { label: 'Площадь ↓', field: 'area', dir: -1 },
};

// Каталог всех проектов (не только топ-5 с главной) с сортировкой по цене/площади.
router.get('/projects', (req, res) => {
  const content = getContent();
  const sort = Object.prototype.hasOwnProperty.call(PROJECT_SORTS, req.query.sort) ? req.query.sort : 'default';
  const { field, dir } = PROJECT_SORTS[sort];

  let houses = content.houses.slice();
  if (field) {
    houses.sort((a, b) => {
      const x = toNumber(a[field]);
      const y = toNumber(b[field]);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * dir;
    });
  }

  res.render('projects', {
    content,
    houses,
    sort,
    sorts: PROJECT_SORTS,
    activePage: 'projects',
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
});

// Портфолио: реализованные объекты с фото, описанием, стоимостью и адресом.
router.get('/portfolio', (req, res) => {
  const content = getContent();
  res.render('portfolio', {
    content,
    items: content.portfolio || [],
    activePage: 'portfolio',
  });
});

router.get('/portfolio/:id', (req, res) => {
  const content = getContent();
  const items = content.portfolio || [];
  const item = items.find((p) => String(p.id) === req.params.id);
  if (!item) return res.status(404).render('404', { content });

  // Встраиваемая Google-карта по адресу (или координатам) — без API-ключа.
  const query = encodeURIComponent(item.address || '');
  res.render('portfolio-item', {
    content,
    item,
    photos: item.photos || [],
    mapEmbedUrl: item.address ? `https://www.google.com/maps?q=${query}&output=embed` : null,
    mapLinkUrl: item.address ? `https://www.google.com/maps/search/?api=1&query=${query}` : null,
    otherItems: items.filter((p) => p !== item).slice(0, 3),
    activePage: 'portfolio',
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
});

function projectFiltersFromQuery(calc, query) {
  return normalizeProjectFilters(calc, {
    areaMin: query.areaMin,
    areaMax: query.areaMax,
    selection: Object.fromEntries((calc.blocks || []).map((block) => [block.id, query[`block-${block.id}`]])),
  });
}

// Подбор по тем же характеристикам, которые заданы в карточках проектов.
router.get('/calculator', (req, res) => {
  const content = getContent();
  const calc = content.calculator;
  if (!calc) return res.status(404).render('404', { content });
  const filters = projectFiltersFromQuery(calc, req.query);
  res.render('calculator', {
    content,
    calc,
    icons: ICONS,
    area: getAreaLimits(calc),
    filters,
    matches: matchProjects(content.houses, calc, filters),
    activePage: 'calculator',
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
});

// Тот же серверный подбор для обновления результатов без перезагрузки.
router.get('/calculator/matches', (req, res) => {
  const content = getContent();
  if (!content.calculator) return res.sendStatus(404);
  const filters = projectFiltersFromQuery(content.calculator, req.query);
  res.set('Cache-Control', 'no-store');
  res.render('partials/project-matches', { matches: matchProjects(content.houses, content.calculator, filters) });
});

// Этапы стройки: вертикальная лента от подготовки участка до наружных сетей.
router.get('/stages', (req, res) => {
  const content = getContent();
  res.render('stages', {
    content,
    stages: content.stages || [],
    activePage: 'stages',
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
});

// Страница отдельного дома: галерея фото, полное описание, характеристики.
router.get('/houses/:id', (req, res) => {
  const content = getContent();
  const house = content.houses.find((h) => String(h.id) === req.params.id);
  if (!house) return res.status(404).render('404', { content });

  const otherHouses = content.houses.filter((h) => String(h.id) !== req.params.id).slice(0, 3);
  res.render('house', {
    content,
    house,
    otherHouses,
    specs: getHouseSpecs(house, content.calculator),
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
});

// Заявка с формы сохраняется в список обращений (со статусом "новая")
// и становится видна администратору в разделе /admin/requests.
// Требования: имя обязательно, из телефона/e-mail — хотя бы одно поле,
// и заполненное поле должно проходить валидацию формата.
router.post('/request', requestLimiter, (req, res) => {
  const { name, phone, email, returnTo } = req.body;
  const trimmedName = (name || '').trim();
  const trimmedPhone = (phone || '').trim();
  const trimmedEmail = (email || '').trim();
  // Разрешаем только относительный внутренний путь: "//host/..." или
  // "/\host/..." браузер трактует как переход на другой домен (open redirect),
  // поэтому такие значения отбрасываем и уходим на главную.
  const isSafeInternalPath = (value) => /^\/(?!\/|\\)/.test(value || '');
  const target = isSafeInternalPath(returnTo) ? returnTo : '/';

  const hasContact = trimmedPhone || trimmedEmail;
  const phoneValid = !trimmedPhone || isValidRuPhone(trimmedPhone);
  const emailValid = !trimmedEmail || isValidEmail(trimmedEmail);

  if (!trimmedName || !hasContact || !phoneValid || !emailValid) {
    return res.redirect(`${target}?error=1#form`);
  }

  addLead({
    name: trimmedName,
    phone: trimmedPhone ? formatRuPhone(trimmedPhone) : '',
    email: trimmedEmail,
    details: calcDetailsFromRequest(req.body.calc, getContent()),
  });
  res.redirect(`${target}?sent=1#form`);
});

module.exports = router;

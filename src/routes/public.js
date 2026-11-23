const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncRoute = require('../middleware/asyncRoute');
const { getContent } = require('../data/store');
const { getHomePage } = require('../utils/homePage');
const { addLead } = require('../data/leadsStore');
const { isValidRuPhone, isValidEmail, formatRuPhone } = require('../utils/validate');
const { getAreaLimits, normalizeProjectFilters, projectArea, matchProjects, describeProjectFilters } = require('../utils/projectMatcher');
const { ICONS } = require('../data/calcIcons');
const { getHouseSpecs, getHouseParameterFields } = require('../utils/houseParameters');
const { getHouseInclusions } = require('../utils/houseInclusions');
const { stageGallery, projectMedia, portfolioMedia } = require('../utils/publicMedia');

const individualPlanningPath = '/individual-planning';

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

function individualPlanningDetails(raw = '') {
  if (typeof raw !== 'string') return null;
  const area = raw.trim();
  if (!area) return 'Индивидуальное проектирование';

  const squareMetres = Number(area.replace(',', '.'));
  if (area.length > 20 || !/^\d+(?:[.,]\d+)?$/.test(area) || !Number.isFinite(squareMetres) || squareMetres <= 0) {
    return null;
  }
  return `Индивидуальное проектирование · Площадь дома ${area.replace('.', ',')} м²`;
}

const router = express.Router();

router.use((req, res, next) => {
  res.locals.projectMedia = projectMedia;
  res.locals.portfolioMedia = portfolioMedia;
  next();
});

// Ограничиваем частоту отправки заявок с одного IP — форма публичная,
// без этого её легко завалить спамом.
const requestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много заявок подряд. Попробуйте снова через несколько минут.' },
});

router.get('/', asyncRoute(async (req, res) => {
  const content = await getContent();
  res.render('index', {
    content,
    homepage: getHomePage(content),
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
}));

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
router.get('/projects', asyncRoute(async (req, res) => {
  const content = await getContent();
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
}));

router.get(individualPlanningPath, asyncRoute(async (req, res) => {
  res.render('individual-planning', {
    content: await getContent(),
    activePage: 'individual-planning',
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
    areaError: req.query.error === 'area',
  });
}));

// Портфолио: реализованные объекты с фото, описанием, стоимостью и адресом.
router.get('/portfolio', asyncRoute(async (req, res) => {
  const content = await getContent();
  res.render('portfolio', {
    content,
    items: content.portfolio || [],
    activePage: 'portfolio',
  });
}));

router.get('/portfolio/:id', asyncRoute(async (req, res) => {
  const content = await getContent();
  const items = content.portfolio || [];
  const item = items.find((p) => String(p.id) === req.params.id);
  if (!item) return res.status(404).render('404', { content });

  // Встраиваемая Google-карта по адресу (или координатам) — без API-ключа.
  const query = encodeURIComponent(item.address || '');
  res.render('portfolio-item', {
    content,
    item,
    media: portfolioMedia(item),
    mapEmbedUrl: item.address ? `https://www.google.com/maps?q=${query}&output=embed` : null,
    mapLinkUrl: item.address ? `https://www.google.com/maps/search/?api=1&query=${query}` : null,
    otherItems: items.filter((p) => p !== item).slice(0, 3),
    activePage: 'portfolio',
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
}));

function projectFiltersFromQuery(calc, query) {
  return normalizeProjectFilters(calc, {
    areaMin: query.areaMin,
    areaMax: query.areaMax,
    selection: Object.fromEntries((calc.blocks || []).map((block) => [block.id, query[`block-${block.id}`]])),
  });
}

function pickerResults(content, query) {
  const calc = content.calculator;
  const filters = projectFiltersFromQuery(calc, query);
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  const sort = ['area-asc', 'area-desc'].includes(query.sort) ? query.sort : 'default';
  const searchKey = (value) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const name = searchKey(search);
  const matches = matchProjects(content.houses, calc, filters)
    .filter((house) => !name || searchKey(String(house.title || '')).includes(name));
  if (sort !== 'default') {
    const direction = sort === 'area-asc' ? 1 : -1;
    matches.sort((a, b) => direction * (projectArea(a.area) - projectArea(b.area)));
  }
  return { calc, filters, search, sort, matches, getHouseParameterFields };
}

// Подбор по тем же характеристикам, которые заданы в карточках проектов.
router.get('/calculator', asyncRoute(async (req, res) => {
  const content = await getContent();
  const calc = content.calculator;
  if (!calc) return res.status(404).render('404', { content });
  res.render('calculator', {
    content,
    ...pickerResults(content, req.query),
    icons: ICONS,
    area: getAreaLimits(calc),
    activePage: 'calculator',
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
}));

// Тот же серверный подбор для обновления результатов без перезагрузки.
router.get('/calculator/matches', asyncRoute(async (req, res) => {
  const content = await getContent();
  if (!content.calculator) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  res.render('partials/project-matches', pickerResults(content, req.query));
}));

// Этапы стройки: вертикальная лента от подготовки участка до наружных сетей.
router.get('/stages', asyncRoute(async (req, res) => {
  const content = await getContent();
  res.render('stages', {
    content,
    stages: (content.stages || []).map((stage) => ({ ...stage, gallery: stageGallery(stage) })),
    activePage: 'stages',
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
}));

// Страница отдельного дома: галерея фото, полное описание, характеристики.
router.get('/houses/:id', asyncRoute(async (req, res) => {
  const content = await getContent();
  const house = content.houses.find((h) => String(h.id) === req.params.id);
  if (!house) return res.status(404).render('404', { content });

  const otherHouses = content.houses.filter((h) => String(h.id) !== req.params.id).slice(0, 3);
  res.render('house', {
    content,
    house,
    media: projectMedia(house),
    otherHouses,
    specs: getHouseSpecs(house, content.calculator),
    inclusions: getHouseInclusions(house, content.stages),
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
}));

// Заявка с формы сохраняется в список обращений (со статусом "новая")
// и становится видна администратору в разделе /admin/requests.
// Требования: имя обязательно, из телефона/e-mail — хотя бы одно поле,
// и заполненное поле должно проходить валидацию формата.
router.post('/request', requestLimiter, asyncRoute(async (req, res) => {
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

  const details = target === individualPlanningPath
    ? individualPlanningDetails(req.body.area)
    : calcDetailsFromRequest(req.body.calc, await getContent());
  if (details === null) return res.redirect(`${target}?error=area#form`);

  await addLead({
    name: trimmedName,
    phone: trimmedPhone ? formatRuPhone(trimmedPhone) : '',
    email: trimmedEmail,
    details,
  });
  res.redirect(`${target}?sent=1#form`);
}));

module.exports = router;

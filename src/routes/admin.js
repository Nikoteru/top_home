const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const rateLimit = require('express-rate-limit');
const { getContent, saveContent } = require('../data/store');
const { getLeads, updateLeadStatus, updateLeadComment, deleteLead } = require('../data/leadsStore');
const { getAdmin, verifyLogin, updateCredentials } = require('../data/adminStore');
const { requireAuth } = require('../middleware/auth');
const { ICONS, DEFAULT_ICON } = require('../data/calcIcons');
const { UNITS, toNumber } = require('../utils/calc');

const STATUS_LABELS = { new: 'Новая', completed: 'Выполнена', rejected: 'Отклонена' };

const DEFAULT_HOUSE_IMAGE = '/images/placeholder-new.svg';
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// Не даём подбирать пароль администратора перебором: 10 попыток за 15 минут с одного IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуйте снова через 15 минут.' },
});

// Удаляет файл картинки, только если он был загружен через админку
// (лежит в /uploads) — картинки-заглушки из /images трогать нельзя.
// Дополнительно проверяем, что итоговый путь не убежал за пределы public/
// через "../" — сейчас imagePath всегда приходит из наших же данных, но
// это дешёвая защита на случай, если логика когда-нибудь изменится.
function deleteUploadedImage(imagePath) {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return;
  const filePath = path.join(PUBLIC_DIR, imagePath);
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) return;
  fs.unlink(filePath, () => {}); // не страшно, если файла уже нет
}

function nextHouseId(houses) {
  return houses.reduce((max, h) => Math.max(max, Number(h.id) || 0), 0) + 1;
}

// Характеристики дома редактируются одним textarea — по строке на пункт,
// в формате "Метка: Значение". Так проще, чем городить динамическую форму.
function parseSpecs(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) return { label: line, value: '' };
      return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    })
    .filter((spec) => spec.label);
}

function serializeSpecs(specs) {
  if (!specs || !specs.length) return '';
  return specs.map((s) => `${s.label}: ${s.value}`).join('\n');
}

const router = express.Router();

// Расширение сохранённого файла берём из проверенного MIME-типа, а не из
// имени файла, которое прислал браузер — оно полностью подконтрольно
// пользователю и его нельзя использовать напрямую (иначе можно было бы,
// подделав заголовок Content-Type, сохранить .html-файл под видом фото и
// получить его же обратно по прямой ссылке из /uploads).
// SVG сюда намеренно не входит: SVG может содержать <script> и выполнится,
// если кто-то откроет файл по прямой ссылке — а фото домов должны быть
// растровыми, так что этим ничем не жертвуем.
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const ALLOWED_TYPES = new Set(Object.keys(MIME_TO_EXT));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || '';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 МБ на файл
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error('Разрешены только изображения (jpg, png, webp, gif)'));
    }
    cb(null, true);
  },
});

// ---- Вход / выход ----

router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (username && password && verifyLogin(username, password)) {
    req.session.isAdmin = true;
    const redirectTo = req.session.redirectTo || '/admin';
    delete req.session.redirectTo;
    return res.redirect(redirectTo);
  }
  res.status(401).render('admin/login', { error: 'Неверный логин или пароль' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ---- Панель управления (всё, что ниже, требует входа) ----

function countNewLeads() {
  return getLeads().filter((l) => l.status === 'new').length;
}

// Админка разбита на страницы по блокам сайта. Для каждой страницы —
// свой шаблон и подпись в меню; /admin ведёт на «Проекты».
const CONTENT_PAGES = {
  houses: 'admin/houses',
  home: 'admin/home',
  contacts: 'admin/contacts',
  portfolio: 'admin/portfolio',
  stages: 'admin/stages',
  calculator: 'admin/calculator',
};

function renderContentPage(req, res, page, { error = null, status = 200 } = {}) {
  res.status(status).render(CONTENT_PAGES[page], {
    content: getContent(),
    saved: !error && req.query.saved === '1',
    error,
    newRequestsCount: countNewLeads(),
    icons: ICONS,
    units: UNITS,
  });
}

router.get('/', requireAuth, (req, res) => res.redirect('/admin/houses'));
router.get('/houses', requireAuth, (req, res) => renderContentPage(req, res, 'houses'));
router.get('/home', requireAuth, (req, res) => renderContentPage(req, res, 'home'));
router.get('/contacts', requireAuth, (req, res) => renderContentPage(req, res, 'contacts'));
router.get('/portfolio', requireAuth, (req, res) => renderContentPage(req, res, 'portfolio'));
router.get('/stages', requireAuth, (req, res) => renderContentPage(req, res, 'stages'));
router.get('/calculator', requireAuth, (req, res) => renderContentPage(req, res, 'calculator'));

// ---- Обращения (заявки с формы на сайте) ----

router.get('/requests', requireAuth, (req, res) => {
  const leads = getLeads();
  res.render('admin/requests', {
    leads,
    newRequestsCount: countNewLeads(),
  });
});

router.post('/requests/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  updateLeadStatus(req.params.id, status);
  res.redirect('/admin/requests');
});

router.post('/requests/:id/comment', requireAuth, (req, res) => {
  const { comment } = req.body;
  updateLeadComment(req.params.id, (comment || '').trim());
  res.redirect('/admin/requests');
});

router.post('/requests/:id/delete', requireAuth, (req, res) => {
  deleteLead(req.params.id);
  res.redirect('/admin/requests');
});

// Выгрузка всех обращений в Excel (.xlsx)
// Express 4 не ловит отклонённые промисы сам — оборачиваем в try/catch
// и передаём ошибку дальше через next(), иначе она уйдёт "в никуда".
router.get('/requests/export.xlsx', requireAuth, async (req, res, next) => {
  try {
    const leads = getLeads();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Обращения');
    sheet.columns = [
      { header: 'Дата', key: 'date', width: 20 },
      { header: 'Имя', key: 'name', width: 24 },
      { header: 'Телефон', key: 'phone', width: 20 },
      { header: 'E-mail', key: 'email', width: 26 },
      { header: 'Статус', key: 'status', width: 16 },
      { header: 'Комментарий', key: 'comment', width: 40 },
      { header: 'Расчёт из калькулятора', key: 'details', width: 60 },
    ];
    sheet.getRow(1).font = { bold: true };

    leads.forEach((lead) => {
      sheet.addRow({
        date: new Date(lead.createdAt).toLocaleString('ru-RU'),
        name: lead.name,
        phone: lead.phone || '',
        email: lead.email || '',
        status: STATUS_LABELS[lead.status] || lead.status,
        comment: lead.comment || '',
        details: lead.details || '',
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Обращения-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// ---- Настройки: смена логина и пароля администратора ----

router.get('/settings', requireAuth, (req, res) => {
  const admin = getAdmin();
  res.render('admin/settings', {
    username: admin.username,
    error: null,
    saved: req.query.saved === '1',
    newRequestsCount: countNewLeads(),
  });
});

router.post('/settings/credentials', requireAuth, (req, res) => {
  const { currentPassword, newUsername, newPassword, newPasswordConfirm } = req.body;
  const admin = getAdmin();

  function fail(message) {
    res.status(400).render('admin/settings', {
      username: admin.username,
      error: message,
      saved: false,
      newRequestsCount: countNewLeads(),
    });
  }

  if (!currentPassword || !verifyLogin(admin.username, currentPassword)) {
    return fail('Текущий пароль указан неверно');
  }
  if (!newUsername || !newUsername.trim()) {
    return fail('Логин не может быть пустым');
  }
  const wantsPasswordChange = newPassword || newPasswordConfirm;
  if (wantsPasswordChange) {
    if (newPassword !== newPasswordConfirm) {
      return fail('Новый пароль и подтверждение не совпадают');
    }
    if (newPassword.length < 8) {
      return fail('Новый пароль должен быть не короче 8 символов');
    }
  }

  updateCredentials({
    username: newUsername,
    password: wantsPasswordChange ? newPassword : undefined,
  });
  res.redirect('/admin/settings?saved=1');
});

// Загрузка/замена картинки hero-баннера
router.post('/hero', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return renderPageError(req, res, 'home', err.message);

    const { title, subtitle } = req.body;
    if (!title || !title.trim()) {
      if (req.file) deleteUploadedImage(`/uploads/${req.file.filename}`);
      return renderPageError(req, res, 'home', 'Заголовок не может быть пустым');
    }

    const content = getContent();
    content.hero.title = title.trim();
    content.hero.subtitle = (subtitle || '').trim();
    if (req.file) {
      deleteUploadedImage(content.hero.image);
      content.hero.image = `/uploads/${req.file.filename}`;
    }

    saveContent(content);
    res.redirect('/admin/home?saved=1');
  });
});

// Правка одного пункта блока «Преимущества» (текст + картинка)
router.post('/advantage/:id', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return renderPageError(req, res, 'home', err.message);

    const content = getContent();
    const advantage = content.advantages.find((a) => String(a.id) === req.params.id);
    if (!advantage) return renderPageError(req, res, 'home', 'Пункт преимуществ не найден');

    const { title, text } = req.body;
    if (title) advantage.title = title;
    if (text) advantage.text = text;
    if (req.file) {
      deleteUploadedImage(advantage.image);
      advantage.image = `/uploads/${req.file.filename}`;
    }

    saveContent(content);
    res.redirect('/admin/home?saved=1');
  });
});

// Правка контактной информации (телефон, e-mail, адрес)
router.post('/contacts', requireAuth, (req, res) => {
  const { phone, email, address } = req.body;
  if (!phone || !phone.trim()) {
    return renderPageError(req, res, 'contacts', 'Укажите телефон');
  }

  const content = getContent();
  content.contacts.phone = phone.trim();
  content.contacts.email = (email || '').trim();
  content.contacts.address = (address || '').trim();
  saveContent(content);
  res.redirect('/admin/contacts?saved=1');
});

// Добавление нового дома
router.post('/house', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return renderPageError(req, res, 'houses', err.message);

    const { title, area, price, description, fullDescription, specs } = req.body;
    if (!title || !title.trim()) {
      if (req.file) deleteUploadedImage(`/uploads/${req.file.filename}`);
      return renderPageError(req, res, 'houses', 'Укажите название дома');
    }

    const content = getContent();
    const house = {
      id: nextHouseId(content.houses),
      title: title.trim(),
      area: (area || '').trim(),
      price: (price || '').trim(),
      description: (description || '').trim(),
      fullDescription: (fullDescription || '').trim(),
      image: req.file ? `/uploads/${req.file.filename}` : DEFAULT_HOUSE_IMAGE,
      gallery: [],
      specs: parseSpecs(specs),
      showOnHome: req.body.showOnHome === '1',
    };
    content.houses.push(house);
    saveContent(content);
    res.redirect('/admin/houses?saved=1');
  });
});

// Загрузка/замена картинки конкретного дома + правка текстовых полей
router.post('/house/:id', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return renderPageError(req, res, 'houses', err.message);

    const content = getContent();
    const house = content.houses.find((h) => String(h.id) === req.params.id);
    if (!house) return renderPageError(req, res, 'houses', 'Дом не найден');

    const { title, area, price, description, fullDescription, specs } = req.body;
    if (title) house.title = title;
    if (area) house.area = area;
    if (price) house.price = price;
    if (description) house.description = description;
    if (fullDescription !== undefined) house.fullDescription = fullDescription.trim();
    if (specs !== undefined) house.specs = parseSpecs(specs);
    // Снятая галочка в форму не отправляется вовсе, поэтому ориентируемся на
    // скрытый маркер: он говорит, что поле в форме было, и тогда отсутствие
    // showOnHome означает «убрать с главной».
    if (req.body.showOnHomeField === '1') house.showOnHome = req.body.showOnHome === '1';
    if (req.file) {
      deleteUploadedImage(house.image);
      house.image = `/uploads/${req.file.filename}`;
    }

    saveContent(content);
    res.redirect('/admin/houses?saved=1');
  });
});

// Добавление фотографий в галерею дома (можно выбрать сразу несколько файлов)
router.post('/house/:id/gallery', requireAuth, (req, res) => {
  upload.array('images', 10)(req, res, (err) => {
    if (err) return renderPageError(req, res, 'houses', err.message);

    const content = getContent();
    const house = content.houses.find((h) => String(h.id) === req.params.id);
    if (!house) return renderPageError(req, res, 'houses', 'Дом не найден');

    if (!req.files || req.files.length === 0) {
      return renderPageError(req, res, 'houses', 'Выберите хотя бы одну фотографию');
    }

    if (!house.gallery) house.gallery = [];
    house.gallery.push(...req.files.map((f) => `/uploads/${f.filename}`));

    saveContent(content);
    res.redirect('/admin/houses?saved=1');
  });
});

// Удаление одной фотографии из галереи дома
router.post('/house/:id/gallery/:index/delete', requireAuth, (req, res) => {
  const content = getContent();
  const house = content.houses.find((h) => String(h.id) === req.params.id);
  if (!house) return renderPageError(req, res, 'houses', 'Дом не найден');

  const index = Number(req.params.index);
  if (!house.gallery || !Number.isInteger(index) || index < 0 || index >= house.gallery.length) {
    return renderPageError(req, res, 'houses', 'Фотография не найдена');
  }

  const [removed] = house.gallery.splice(index, 1);
  deleteUploadedImage(removed);
  saveContent(content);
  res.redirect('/admin/houses?saved=1');
});

// Удаление дома
router.post('/house/:id/delete', requireAuth, (req, res) => {
  const content = getContent();
  const index = content.houses.findIndex((h) => String(h.id) === req.params.id);
  if (index === -1) return renderPageError(req, res, 'houses', 'Дом не найден');

  const [removed] = content.houses.splice(index, 1);
  deleteUploadedImage(removed.image);
  (removed.gallery || []).forEach(deleteUploadedImage);
  saveContent(content);
  res.redirect('/admin/houses?saved=1');
});

// ---- Портфолио (реализованные объекты: фото, описание, стоимость, адрес) ----

function findPortfolioItem(content, id) {
  return (content.portfolio || []).find((p) => String(p.id) === String(id));
}

function portfolioRedirect(res, id) {
  res.redirect(`/admin/portfolio?saved=1${id ? `&open=${encodeURIComponent(id)}` : ''}`);
}

// Новый объект: текстовые поля + сразу можно загрузить пачку фото.
router.post('/portfolio', requireAuth, (req, res) => {
  upload.array('photos', 30)(req, res, (err) => {
    if (err) return renderPageError(req, res, 'portfolio', err.message);

    const uploaded = (req.files || []).map((f) => `/uploads/${f.filename}`);
    const { title, price, address, description } = req.body;
    if (!title || !title.trim()) {
      uploaded.forEach(deleteUploadedImage);
      return renderPageError(req, res, 'portfolio', 'Укажите название объекта');
    }

    const content = getContent();
    if (!Array.isArray(content.portfolio)) content.portfolio = [];
    const item = {
      id: nextHouseId(content.portfolio),
      title: title.trim(),
      price: (price || '').trim(),
      address: (address || '').trim(),
      description: (description || '').trim(),
      photos: uploaded,
    };
    content.portfolio.push(item);
    saveContent(content);
    portfolioRedirect(res, item.id);
  });
});

// Правка текстовых полей объекта. Пустые поля (кроме названия) можно
// очистить намеренно — например, убрать цену.
router.post('/portfolio/:id', requireAuth, (req, res) => {
  const content = getContent();
  const item = findPortfolioItem(content, req.params.id);
  if (!item) return renderPageError(req, res, 'portfolio', 'Объект не найден');

  const { title, price, address, description } = req.body;
  if (!title || !title.trim()) {
    return renderPageError(req, res, 'portfolio', 'Название объекта не может быть пустым');
  }
  item.title = title.trim();
  item.price = (price || '').trim();
  item.address = (address || '').trim();
  item.description = (description || '').trim();
  saveContent(content);
  portfolioRedirect(res, item.id);
});

// Догрузка фотографий к объекту (можно выбрать сразу несколько).
router.post('/portfolio/:id/photos', requireAuth, (req, res) => {
  upload.array('photos', 30)(req, res, (err) => {
    if (err) return renderPageError(req, res, 'portfolio', err.message);

    const uploaded = (req.files || []).map((f) => `/uploads/${f.filename}`);
    const content = getContent();
    const item = findPortfolioItem(content, req.params.id);
    if (!item) {
      uploaded.forEach(deleteUploadedImage);
      return renderPageError(req, res, 'portfolio', 'Объект не найден');
    }
    if (uploaded.length === 0) {
      return renderPageError(req, res, 'portfolio', 'Выберите хотя бы одну фотографию');
    }

    if (!Array.isArray(item.photos)) item.photos = [];
    item.photos.push(...uploaded);
    saveContent(content);
    portfolioRedirect(res, item.id);
  });
});

function getPhotoIndex(item, rawIndex) {
  const index = Number(rawIndex);
  if (!item || !Array.isArray(item.photos)) return -1;
  return Number.isInteger(index) && index >= 0 && index < item.photos.length ? index : -1;
}

// Сделать фото обложкой — переносим его в начало списка.
router.post('/portfolio/:id/photos/:index/cover', requireAuth, (req, res) => {
  const content = getContent();
  const item = findPortfolioItem(content, req.params.id);
  const index = getPhotoIndex(item, req.params.index);
  if (index === -1) return renderPageError(req, res, 'portfolio', 'Фотография не найдена');

  const [photo] = item.photos.splice(index, 1);
  item.photos.unshift(photo);
  saveContent(content);
  portfolioRedirect(res, item.id);
});

router.post('/portfolio/:id/photos/:index/delete', requireAuth, (req, res) => {
  const content = getContent();
  const item = findPortfolioItem(content, req.params.id);
  const index = getPhotoIndex(item, req.params.index);
  if (index === -1) return renderPageError(req, res, 'portfolio', 'Фотография не найдена');

  const [removed] = item.photos.splice(index, 1);
  deleteUploadedImage(removed);
  saveContent(content);
  portfolioRedirect(res, item.id);
});

router.post('/portfolio/:id/delete', requireAuth, (req, res) => {
  const content = getContent();
  const list = content.portfolio || [];
  const index = list.findIndex((p) => String(p.id) === req.params.id);
  if (index === -1) return renderPageError(req, res, 'portfolio', 'Объект не найден');

  const [removed] = list.splice(index, 1);
  (removed.photos || []).forEach(deleteUploadedImage);
  saveContent(content);
  portfolioRedirect(res);
});

// ---- Этапы стройки (вертикальная лента этапов, у каждого — свои фото) ----
// Порядок этапов на сайте = порядок в массиве content.stages.

function findStage(content, id) {
  return (content.stages || []).find((s) => String(s.id) === String(id));
}

function stagesRedirect(res, id) {
  const open = id ? `&open=${encodeURIComponent(id)}#stage-${encodeURIComponent(id)}` : '';
  res.redirect(`/admin/stages?saved=1${open}`);
}

router.post('/stages', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return renderPageError(req, res, 'stages', 'Укажите название этапа');

  const content = getContent();
  if (!Array.isArray(content.stages)) content.stages = [];
  const stage = { id: nextHouseId(content.stages), title, description: '', photos: [] };
  content.stages.push(stage);
  saveContent(content);
  stagesRedirect(res, stage.id);
});

router.post('/stages/:id', requireAuth, (req, res) => {
  const content = getContent();
  const stage = findStage(content, req.params.id);
  if (!stage) return renderPageError(req, res, 'stages', 'Этап не найден');

  const title = (req.body.title || '').trim();
  if (!title) return renderPageError(req, res, 'stages', 'Название этапа не может быть пустым');
  stage.title = title;
  stage.description = (req.body.description || '').trim();
  saveContent(content);
  stagesRedirect(res, stage.id);
});

// Перемещение этапа на одну позицию вверх/вниз по ленте.
router.post('/stages/:id/move', requireAuth, (req, res) => {
  const content = getContent();
  const list = content.stages || [];
  const index = list.findIndex((s) => String(s.id) === req.params.id);
  if (index === -1) return renderPageError(req, res, 'stages', 'Этап не найден');

  const target = req.body.direction === 'up' ? index - 1 : index + 1;
  if (target >= 0 && target < list.length) {
    [list[index], list[target]] = [list[target], list[index]];
    saveContent(content);
  }
  stagesRedirect(res, req.params.id);
});

router.post('/stages/:id/photos', requireAuth, (req, res) => {
  upload.array('photos', 30)(req, res, (err) => {
    if (err) return renderPageError(req, res, 'stages', err.message);

    const uploaded = (req.files || []).map((f) => `/uploads/${f.filename}`);
    const content = getContent();
    const stage = findStage(content, req.params.id);
    if (!stage) {
      uploaded.forEach(deleteUploadedImage);
      return renderPageError(req, res, 'stages', 'Этап не найден');
    }
    if (uploaded.length === 0) {
      return renderPageError(req, res, 'stages', 'Выберите хотя бы одну фотографию');
    }

    if (!Array.isArray(stage.photos)) stage.photos = [];
    stage.photos.push(...uploaded);
    saveContent(content);
    stagesRedirect(res, stage.id);
  });
});

router.post('/stages/:id/photos/:index/delete', requireAuth, (req, res) => {
  const content = getContent();
  const stage = findStage(content, req.params.id);
  const index = getPhotoIndex(stage, req.params.index);
  if (index === -1) return renderPageError(req, res, 'stages', 'Фотография не найдена');

  const [removed] = stage.photos.splice(index, 1);
  deleteUploadedImage(removed);
  saveContent(content);
  stagesRedirect(res, stage.id);
});

router.post('/stages/:id/delete', requireAuth, (req, res) => {
  const content = getContent();
  const list = content.stages || [];
  const index = list.findIndex((s) => String(s.id) === req.params.id);
  if (index === -1) return renderPageError(req, res, 'stages', 'Этап не найден');

  const [removed] = list.splice(index, 1);
  (removed.photos || []).forEach(deleteUploadedImage);
  saveContent(content);
  stagesRedirect(res);
});

// ---- Калькулятор стоимости: общие настройки, блоки и варианты ----

function calcRedirect(res, blockId) {
  const anchor = blockId ? `#calc-block-${encodeURIComponent(blockId)}` : '';
  res.redirect(`/admin/calculator?saved=1${anchor}`);
}

function getCalc(content) {
  if (!content.calculator) {
    content.calculator = { title: 'Калькулятор стоимости дома', intro: '', note: '', area: { min: 60, max: 400, step: 5, default: 120 }, blocks: [] };
  }
  if (!Array.isArray(content.calculator.blocks)) content.calculator.blocks = [];
  return content.calculator;
}

function nextOptionId(calc) {
  return calc.blocks.reduce((max, b) => (b.options || []).reduce((m, o) => Math.max(m, Number(o.id) || 0), max), 0) + 1;
}

// Цена варианта: для коэффициента — положительное число (по умолчанию 1),
// для остальных — неотрицательная сумма в рублях.
function parseOptionPrice(raw, unit) {
  const value = toNumber(raw, unit === 'coef' ? 1 : 0);
  if (unit === 'coef') return value > 0 ? value : 1;
  return Math.max(0, Math.round(value));
}

router.post('/calculator/settings', requireAuth, (req, res) => {
  const content = getContent();
  const calc = getCalc(content);
  const { title, intro, note, areaMin, areaMax, areaStep, areaDefault } = req.body;

  const min = Math.round(toNumber(areaMin, NaN));
  const max = Math.round(toNumber(areaMax, NaN));
  const step = Math.round(toNumber(areaStep, NaN));
  const def = Math.round(toNumber(areaDefault, NaN));
  if (![min, max, step, def].every(Number.isFinite) || min < 1 || step < 1 || max <= min) {
    return renderPageError(req, res, 'calculator', 'Проверьте площадь: минимум ≥ 1, максимум больше минимума, шаг ≥ 1');
  }
  if (def < min || def > max) {
    return renderPageError(req, res, 'calculator', 'Площадь по умолчанию должна быть между минимумом и максимумом');
  }

  calc.title = (title || '').trim() || 'Калькулятор стоимости дома';
  calc.intro = (intro || '').trim();
  calc.note = (note || '').trim();
  calc.area = { min, max, step, default: def };
  saveContent(content);
  calcRedirect(res);
});

router.post('/calculator/blocks', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return renderPageError(req, res, 'calculator', 'Укажите название блока');

  const content = getContent();
  const calc = getCalc(content);
  const block = {
    id: calc.blocks.reduce((m, b) => Math.max(m, Number(b.id) || 0), 0) + 1,
    title,
    multiple: req.body.multiple === '1',
    options: [],
  };
  calc.blocks.push(block);
  saveContent(content);
  calcRedirect(res, block.id);
});

// Сохранение блока целиком: название, тип выбора и все варианты в нём
// (с иконками). Новый вариант добавляется, если заполнено его название.
router.post('/calculator/blocks/:id', requireAuth, (req, res) => {
  upload.any()(req, res, (err) => {
    const uploadedFiles = (req.files || []).map((f) => ({ field: f.fieldname, path: `/uploads/${f.filename}` }));
    const dropUploads = () => uploadedFiles.forEach((f) => deleteUploadedImage(f.path));
    if (err) {
      dropUploads();
      return renderPageError(req, res, 'calculator', err.message);
    }

    const content = getContent();
    const calc = getCalc(content);
    const block = calc.blocks.find((b) => String(b.id) === req.params.id);
    if (!block) {
      dropUploads();
      return renderPageError(req, res, 'calculator', 'Блок не найден');
    }

    const title = (req.body.title || '').trim();
    if (!title) {
      dropUploads();
      return renderPageError(req, res, 'calculator', 'Название блока не может быть пустым');
    }

    const fileFor = (field) => {
      const f = uploadedFiles.find((u) => u.field === field);
      if (f) f.used = true;
      return f ? f.path : null;
    };

    function applyIcon(option, iconChoice, uploaded) {
      if (uploaded) {
        deleteUploadedImage(option.image);
        option.image = uploaded;
        return;
      }
      if (iconChoice && iconChoice !== '__custom') {
        if (option.image) deleteUploadedImage(option.image);
        option.image = '';
        option.icon = ICONS[iconChoice] ? iconChoice : DEFAULT_ICON;
      }
    }

    const rows = Array.isArray(req.body.options) ? req.body.options : Object.values(req.body.options || {});
    const kept = [];
    rows.forEach((row, i) => {
      if (!row) return;
      const option = (block.options || []).find((o) => String(o.id) === String(row.id));
      if (!option) return;
      if (row.remove === '1') {
        deleteUploadedImage(option.image);
        return;
      }
      const unit = UNITS[row.unit] ? row.unit : 'm2';
      option.title = (row.title || '').trim() || option.title;
      option.hint = (row.hint || '').trim();
      option.unit = unit;
      option.price = parseOptionPrice(row.price, unit);
      applyIcon(option, row.icon, fileFor(`icon_${i}`));
      kept.push(option);
    });
    // Варианты, которых почему-то не было в форме, не теряем.
    (block.options || []).forEach((o) => {
      const inForm = rows.some((r) => r && String(r.id) === String(o.id));
      if (!inForm) kept.push(o);
    });

    const fresh = req.body.newOption || {};
    const freshTitle = (fresh.title || '').trim();
    if (freshTitle) {
      const unit = UNITS[fresh.unit] ? fresh.unit : 'm2';
      const option = {
        id: nextOptionId(calc),
        title: freshTitle,
        hint: (fresh.hint || '').trim(),
        icon: ICONS[fresh.icon] ? fresh.icon : DEFAULT_ICON,
        image: '',
        price: parseOptionPrice(fresh.price, unit),
        unit,
      };
      applyIcon(option, null, fileFor('icon_new'));
      kept.push(option);
    }

    block.title = title;
    block.multiple = req.body.multiple === '1';
    block.options = kept;

    uploadedFiles.filter((f) => !f.used).forEach((f) => deleteUploadedImage(f.path));
    saveContent(content);
    calcRedirect(res, block.id);
  });
});

router.post('/calculator/blocks/:id/move', requireAuth, (req, res) => {
  const content = getContent();
  const list = getCalc(content).blocks;
  const index = list.findIndex((b) => String(b.id) === req.params.id);
  if (index === -1) return renderPageError(req, res, 'calculator', 'Блок не найден');

  const target = req.body.direction === 'up' ? index - 1 : index + 1;
  if (target >= 0 && target < list.length) {
    [list[index], list[target]] = [list[target], list[index]];
    saveContent(content);
  }
  calcRedirect(res, req.params.id);
});

router.post('/calculator/blocks/:id/delete', requireAuth, (req, res) => {
  const content = getContent();
  const list = getCalc(content).blocks;
  const index = list.findIndex((b) => String(b.id) === req.params.id);
  if (index === -1) return renderPageError(req, res, 'calculator', 'Блок не найден');

  const [removed] = list.splice(index, 1);
  (removed.options || []).forEach((o) => deleteUploadedImage(o.image));
  saveContent(content);
  calcRedirect(res);
});

function renderPageError(req, res, page, message) {
  renderContentPage(req, res, page, { error: message, status: 400 });
}

module.exports = router;

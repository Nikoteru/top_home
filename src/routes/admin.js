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

router.get('/', requireAuth, (req, res) => {
  const content = getContent();
  res.render('admin/dashboard', {
    content,
    saved: req.query.saved === '1',
    error: null,
    newRequestsCount: countNewLeads(),
  });
});

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
    if (err) return renderDashboardError(req, res, err.message);

    const { title, subtitle } = req.body;
    if (!title || !title.trim()) {
      if (req.file) deleteUploadedImage(`/uploads/${req.file.filename}`);
      return renderDashboardError(req, res, 'Заголовок не может быть пустым');
    }

    const content = getContent();
    content.hero.title = title.trim();
    content.hero.subtitle = (subtitle || '').trim();
    if (req.file) {
      deleteUploadedImage(content.hero.image);
      content.hero.image = `/uploads/${req.file.filename}`;
    }

    saveContent(content);
    res.redirect('/admin?saved=1');
  });
});

// Правка одного пункта блока «Преимущества» (текст + картинка)
router.post('/advantage/:id', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return renderDashboardError(req, res, err.message);

    const content = getContent();
    const advantage = content.advantages.find((a) => String(a.id) === req.params.id);
    if (!advantage) return renderDashboardError(req, res, 'Пункт преимуществ не найден');

    const { title, text } = req.body;
    if (title) advantage.title = title;
    if (text) advantage.text = text;
    if (req.file) {
      deleteUploadedImage(advantage.image);
      advantage.image = `/uploads/${req.file.filename}`;
    }

    saveContent(content);
    res.redirect('/admin?saved=1');
  });
});

// Правка контактной информации (телефон, e-mail, адрес)
router.post('/contacts', requireAuth, (req, res) => {
  const { phone, email, address } = req.body;
  if (!phone || !phone.trim()) {
    return renderDashboardError(req, res, 'Укажите телефон');
  }

  const content = getContent();
  content.contacts.phone = phone.trim();
  content.contacts.email = (email || '').trim();
  content.contacts.address = (address || '').trim();
  saveContent(content);
  res.redirect('/admin?saved=1');
});

// Добавление нового дома
router.post('/house', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return renderDashboardError(req, res, err.message);

    const { title, area, price, description, fullDescription, specs } = req.body;
    if (!title || !title.trim()) {
      if (req.file) deleteUploadedImage(`/uploads/${req.file.filename}`);
      return renderDashboardError(req, res, 'Укажите название дома');
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
    };
    content.houses.push(house);
    saveContent(content);
    res.redirect('/admin?saved=1');
  });
});

// Загрузка/замена картинки конкретного дома + правка текстовых полей
router.post('/house/:id', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return renderDashboardError(req, res, err.message);

    const content = getContent();
    const house = content.houses.find((h) => String(h.id) === req.params.id);
    if (!house) return renderDashboardError(req, res, 'Дом не найден');

    const { title, area, price, description, fullDescription, specs } = req.body;
    if (title) house.title = title;
    if (area) house.area = area;
    if (price) house.price = price;
    if (description) house.description = description;
    if (fullDescription !== undefined) house.fullDescription = fullDescription.trim();
    if (specs !== undefined) house.specs = parseSpecs(specs);
    if (req.file) {
      deleteUploadedImage(house.image);
      house.image = `/uploads/${req.file.filename}`;
    }

    saveContent(content);
    res.redirect('/admin?saved=1');
  });
});

// Добавление фотографий в галерею дома (можно выбрать сразу несколько файлов)
router.post('/house/:id/gallery', requireAuth, (req, res) => {
  upload.array('images', 10)(req, res, (err) => {
    if (err) return renderDashboardError(req, res, err.message);

    const content = getContent();
    const house = content.houses.find((h) => String(h.id) === req.params.id);
    if (!house) return renderDashboardError(req, res, 'Дом не найден');

    if (!req.files || req.files.length === 0) {
      return renderDashboardError(req, res, 'Выберите хотя бы одну фотографию');
    }

    if (!house.gallery) house.gallery = [];
    house.gallery.push(...req.files.map((f) => `/uploads/${f.filename}`));

    saveContent(content);
    res.redirect('/admin?saved=1');
  });
});

// Удаление одной фотографии из галереи дома
router.post('/house/:id/gallery/:index/delete', requireAuth, (req, res) => {
  const content = getContent();
  const house = content.houses.find((h) => String(h.id) === req.params.id);
  if (!house) return renderDashboardError(req, res, 'Дом не найден');

  const index = Number(req.params.index);
  if (!house.gallery || !Number.isInteger(index) || index < 0 || index >= house.gallery.length) {
    return renderDashboardError(req, res, 'Фотография не найдена');
  }

  const [removed] = house.gallery.splice(index, 1);
  deleteUploadedImage(removed);
  saveContent(content);
  res.redirect('/admin?saved=1');
});

// Удаление дома
router.post('/house/:id/delete', requireAuth, (req, res) => {
  const content = getContent();
  const index = content.houses.findIndex((h) => String(h.id) === req.params.id);
  if (index === -1) return renderDashboardError(req, res, 'Дом не найден');

  const [removed] = content.houses.splice(index, 1);
  deleteUploadedImage(removed.image);
  (removed.gallery || []).forEach(deleteUploadedImage);
  saveContent(content);
  res.redirect('/admin?saved=1');
});

function renderDashboardError(req, res, message) {
  const content = getContent();
  res.status(400).render('admin/dashboard', {
    content,
    saved: false,
    error: message,
    newRequestsCount: countNewLeads(),
  });
}

module.exports = router;

const express = require('express');
const { getContent } = require('../data/store');
const { addLead } = require('../data/leadsStore');
const { isValidRuPhone, isValidEmail, formatRuPhone } = require('../utils/validate');

const router = express.Router();

router.get('/', (req, res) => {
  const content = getContent();
  res.render('index', {
    content,
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
    sent: req.query.sent === '1',
    formError: req.query.error === '1',
  });
});

// Заявка с формы сохраняется в список обращений (со статусом "новая")
// и становится видна администратору в разделе /admin/requests.
// Требования: имя обязательно, из телефона/e-mail — хотя бы одно поле,
// и заполненное поле должно проходить валидацию формата.
router.post('/request', (req, res) => {
  const { name, phone, email, returnTo } = req.body;
  const trimmedName = (name || '').trim();
  const trimmedPhone = (phone || '').trim();
  const trimmedEmail = (email || '').trim();
  const target = returnTo && returnTo.startsWith('/') ? returnTo : '/';

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
  });
  res.redirect(`${target}?sent=1#form`);
});

module.exports = router;

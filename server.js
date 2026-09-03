require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const crypto = require('crypto');

const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Стандартные защитные HTTP-заголовки (X-Content-Type-Options, X-Frame-Options,
// скрытие заголовка X-Powered-By и т.д.). CSP пока отключаем: страницы
// используют встроенные <script>-блоки, и включать политику без переработки
// шаблонов под nonce/hash значило бы либо сломать сайт, либо дать пустую CSP.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SESSION_SECRET обязателен для подписи сессионных cookie. Если его не
// задали в .env — используем случайный секрет на время работы процесса
// (сессии слетят при перезапуске), а не предсказуемую строку по умолчанию:
// захардкоженный секрет позволил бы подделать cookie администратора.
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn(
    '⚠ SESSION_SECRET не задан в .env — используется временный случайный секрет. ' +
      'Добавьте свой SESSION_SECRET в .env, иначе все сессии обнулятся при перезапуске сервера.'
  );
}

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax', // базовая защита от CSRF: cookie не уйдёт при кросс-сайтовой отправке формы
      secure: IS_PRODUCTION, // на проде (за HTTPS) cookie только по защищённому соединению
      maxAge: 1000 * 60 * 60 * 8, // 8 часов
    },
  })
);

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).send('Страница не найдена');
});

// Общий обработчик ошибок — не отдаём стек вызовов и внутренние детали
// клиенту (даже если кто-то забудет NODE_ENV=production на проде).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Что-то пошло не так. Попробуйте ещё раз позже.');
});

app.listen(PORT, () => {
  console.log(`Сайт запущен: http://localhost:${PORT}`);
  console.log(`Админка:      http://localhost:${PORT}/admin`);
});

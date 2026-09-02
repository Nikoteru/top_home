// Простой middleware: пускает дальше только залогиненного администратора.
// Если сессии нет — отправляем на страницу входа и запоминаем, куда человек шёл.
function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  req.session.redirectTo = req.originalUrl;
  return res.redirect('/admin/login');
}

module.exports = { requireAuth };

// Универсальное подтверждение удаления. Текст берём из data-атрибута
// (безопасно проходит через обычное HTML-экранирование EJS) вместо того,
// чтобы собирать JS-код из чужих строк прямо в onsubmit="..." — так надёжнее:
// встроенные обработчики событий в HTML разбираются браузером дважды
// (сначала как HTML-атрибут, потом как JS), и ручное экранирование кавычек
// для этого случая легко сделать неправильно.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-confirm-delete]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!confirm(form.dataset.confirmDelete)) {
        e.preventDefault();
      }
    });
  });
});

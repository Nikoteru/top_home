// Автоматически прячем всплывающие уведомления (успех/ошибка отправки заявки) через 5 секунд.
document.addEventListener('DOMContentLoaded', () => {
  ['toast', 'toastError'].forEach((id) => {
    const toast = document.getElementById(id);
    if (!toast) return;
    setTimeout(() => {
      toast.style.transition = 'opacity .4s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, 5000);
  });
});

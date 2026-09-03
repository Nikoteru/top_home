// Листалка карточек домов в админке: показывает одну карточку за раз вместо
// длинного списка одна под другой. Текущий выбранный дом запоминается в
// localStorage — после сохранения формы (обычный POST + перезагрузка
// страницы) админ остаётся на той же карточке, а не улетает к первой.
document.addEventListener('DOMContentLoaded', () => {
  const pages = Array.from(document.querySelectorAll('#housePages > [data-house-id]'));
  const pagerItems = Array.from(document.querySelectorAll('.admin-pager__item'));
  const prevBtn = document.getElementById('housePagerPrev');
  const nextBtn = document.getElementById('housePagerNext');
  const counter = document.getElementById('housePagerCounter');
  if (!pages.length) return;

  const STORAGE_KEY = 'adminActiveHouseId';
  let currentIndex = 0;

  function getStoredId() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeId(id) {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {
      /* приватный режим браузера и т.п. — просто не запоминаем */
    }
  }

  function showPage(index) {
    if (index < 0 || index >= pages.length) return;
    currentIndex = index;
    pages.forEach((page, i) => {
      page.hidden = i !== index;
    });
    pagerItems.forEach((btn, i) => btn.classList.toggle('is-active', i === index));
    if (counter) counter.textContent = `${index + 1} / ${pages.length}`;
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === pages.length - 1;
    const activeBtn = pagerItems[index];
    if (activeBtn) activeBtn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    storeId(pages[index].dataset.houseId);
  }

  pagerItems.forEach((btn, i) => {
    btn.addEventListener('click', () => showPage(i));
  });
  if (prevBtn) prevBtn.addEventListener('click', () => showPage(currentIndex - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => showPage(currentIndex + 1));

  const storedId = getStoredId();
  const restoredIndex = storedId ? pages.findIndex((p) => p.dataset.houseId === storedId) : -1;
  showPage(restoredIndex !== -1 ? restoredIndex : 0);
});

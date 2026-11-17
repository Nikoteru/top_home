// Этапы стройки: клик по этапу в ленте показывает его фото и описание
// в общем блоке справа. Выбранный этап попадает в адрес (#stage-ID),
// поэтому ссылкой можно поделиться. Клик по фото открывает лайтбокс.
document.addEventListener('DOMContentLoaded', () => {
  const buttons = Array.from(document.querySelectorAll('.timeline__btn'));
  const panels = Array.from(document.querySelectorAll('.stage-panel__item'));
  const panelBox = document.getElementById('stagePanel');
  if (!buttons.length || !panels.length) return;

  const isNarrow = () => window.matchMedia('(max-width: 900px)').matches;

  function selectStage(index, { scroll = false, updateHash = true } = {}) {
    if (index < 0 || index >= panels.length) return;
    buttons.forEach((btn, i) => {
      btn.classList.toggle('is-active', i === index);
      btn.setAttribute('aria-pressed', String(i === index));
    });
    panels.forEach((panel, i) => {
      panel.hidden = i !== index;
    });
    if (updateHash) {
      history.replaceState(null, '', `#stage-${panels[index].dataset.stageId}`);
    }
    // На телефоне блок с фото стоит под лентой — прокручиваем к нему.
    if (scroll && isNarrow()) {
      panelBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  buttons.forEach((btn, i) => {
    btn.addEventListener('click', () => selectStage(i, { scroll: true }));
  });

  document.querySelectorAll('[data-stage-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.stageGo);
      selectStage(index);
      buttons[index].scrollIntoView({ block: 'nearest' });
      if (isNarrow()) panelBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Открыли страницу по ссылке вида /stages#stage-5 — показываем этот этап.
  const match = window.location.hash.match(/^#stage-(.+)$/);
  if (match) {
    const index = panels.findIndex((p) => p.dataset.stageId === decodeURIComponent(match[1]));
    if (index !== -1) selectStage(index, { updateHash: false });
  }

  // ---- Лайтбокс: листаем фото выбранного этапа ----
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;
  const image = document.getElementById('lightboxImage');
  const counter = document.getElementById('lightboxCounter');
  const prevBtn = document.getElementById('lightboxPrev');
  const nextBtn = document.getElementById('lightboxNext');
  const closeBtn = document.getElementById('lightboxClose');

  let photos = [];
  let current = 0;

  function render() {
    image.src = photos[current];
    const multiple = photos.length > 1;
    prevBtn.hidden = !multiple;
    nextBtn.hidden = !multiple;
    counter.textContent = multiple ? `${current + 1} / ${photos.length}` : '';
  }

  function open(list, start) {
    photos = list;
    current = start;
    render();
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function close() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
  }

  function step(delta) {
    if (photos.length < 2) return;
    current = (current + delta + photos.length) % photos.length;
    render();
  }

  document.querySelectorAll('[data-stage-gallery]').forEach((gallery) => {
    let list;
    try {
      list = JSON.parse(gallery.dataset.stageGallery);
    } catch (e) {
      return;
    }
    gallery.querySelectorAll('.stage-panel__photo').forEach((btn) => {
      btn.addEventListener('click', () => open(list, Number(btn.dataset.index) || 0));
    });
  });

  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) close();
  });
  document.addEventListener('keydown', (e) => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });
});

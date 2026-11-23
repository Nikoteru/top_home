document.addEventListener('DOMContentLoaded', () => {
  const main = document.getElementById('galleryMain');
  const mainImage = main?.querySelector('img');
  const images = Array.isArray(window.HOUSE_GALLERY) ? window.HOUSE_GALLERY : [];
  if (!mainImage || images.length === 0) return;

  const gallery = main.closest('.house-detail-gallery');
  const thumbnails = gallery.querySelector('.gallery-thumbs');
  const thumbs = [...gallery.querySelectorAll('.gallery-thumb')];
  const caption = main.querySelector('[data-gallery-caption]');
  const counter = gallery.querySelector('[data-gallery-position]');
  const lightbox = document.getElementById('lightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxCounter = document.getElementById('lightboxCounter');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');
  const hasMultiple = images.length > 1;
  const modalButtons = hasMultiple ? [lightboxClose, lightboxPrev, lightboxNext] : [lightboxClose];
  lightboxPrev.hidden = !hasMultiple;
  lightboxNext.hidden = !hasMultiple;

  let currentIndex = 0;
  let savedOverflow = '';

  function positionText() {
    return `${currentIndex + 1} / ${images.length}`;
  }

  function updateLightbox() {
    lightboxImage.src = images[currentIndex];
    lightboxImage.alt = caption.textContent || `Изображение ${currentIndex + 1}`;
    lightboxCounter.textContent = hasMultiple ? positionText() : '';
  }

  function setMainImage(index) {
    currentIndex = index;
    mainImage.src = images[index];
    const label = thumbs[index]?.dataset.caption || '';
    caption.textContent = label;
    caption.hidden = !label;
    main.setAttribute('aria-label', label ? `Увеличить изображение — ${label}` : 'Увеличить изображение');
    if (counter) counter.textContent = positionText();
    thumbs.forEach((thumb, i) => {
      thumb.classList.toggle('is-active', i === index);
      thumb.setAttribute('aria-pressed', String(i === index));
    });
    if (thumbnails && thumbnails.scrollWidth > thumbnails.clientWidth) {
      const rail = thumbnails.getBoundingClientRect();
      const thumb = thumbs[index].getBoundingClientRect();
      const delta = Math.max(0, thumb.right - rail.right) + Math.min(0, thumb.left - rail.left);
      if (delta) thumbnails.scrollBy({ left: delta });
    }
    if (!lightbox.hidden) updateLightbox();
  }

  function step(delta) {
    setMainImage((currentIndex + delta + images.length) % images.length);
  }

  function openLightbox() {
    updateLightbox();
    lightbox.hidden = false;
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    lightboxClose.focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    document.body.style.overflow = savedOverflow;
    main.focus({ preventScroll: true });
  }

  function enableSwipe(surface) {
    let start = null;
    let swiped = false;
    surface.addEventListener('pointerdown', (event) => {
      swiped = false;
      start = event.pointerType === 'touch' ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
    });
    surface.addEventListener('pointercancel', () => { start = null; });
    surface.addEventListener('pointerup', (event) => {
      if (event.pointerId !== start?.id) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      swiped = true;
      step(dx < 0 ? 1 : -1);
    });
    surface.addEventListener('click', (event) => {
      if (swiped && event.detail > 0) event.stopImmediatePropagation();
      swiped = false;
    }, true);
  }

  thumbs.forEach((thumb, i) => thumb.addEventListener('click', () => setMainImage(i)));
  const arrows = gallery.querySelectorAll('[data-gallery-step]');
  arrows.forEach((button) => button.addEventListener('click', () => step(Number(button.dataset.galleryStep))));
  if (arrows.length) {
    enableSwipe(main);
    enableSwipe(lightboxImage);
  }

  main.addEventListener('click', openLightbox);
  lightboxClose.addEventListener('click', closeLightbox);
  lightboxNext.addEventListener('click', () => step(1));
  lightboxPrev.addEventListener('click', () => step(-1));

  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (event) => {
    if (!lightbox.hidden && event.key === 'Escape') {
      closeLightbox();
      return;
    }
    if (!lightbox.hidden && event.key === 'Tab') {
      const first = modalButtons[0];
      const last = modalButtons[modalButtons.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
      return;
    }
    const canStep = !lightbox.hidden || (arrows.length && gallery.contains(event.target));
    if (!canStep || !hasMultiple || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  });
});

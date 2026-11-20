// Переключение главного фото по клику на миниатюру + лайтбокс с увеличением.
document.addEventListener('DOMContentLoaded', () => {
  const main = document.getElementById('galleryMain');
  const mainImage = main?.querySelector('img');
  const thumbs = document.querySelectorAll('.gallery-thumb');
  const images = Array.isArray(window.HOUSE_GALLERY) ? window.HOUSE_GALLERY : [];
  if (!mainImage || images.length === 0) return;

  let currentIndex = 0;

  function setMainImage(index) {
    currentIndex = index;
    mainImage.src = images[index];
    thumbs.forEach((thumb, i) => {
      thumb.classList.toggle('is-active', i === index);
      thumb.setAttribute('aria-pressed', String(i === index));
    });
  }

  thumbs.forEach((thumb, i) => {
    thumb.addEventListener('click', () => setMainImage(i));
  });

  // ---- Лайтбокс ----
  const lightbox = document.getElementById('lightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxCounter = document.getElementById('lightboxCounter');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');
  if (!lightbox) return;

  const hasMultiple = images.length > 1;
  lightboxPrev.hidden = !hasMultiple;
  lightboxNext.hidden = !hasMultiple;

  function updateLightbox() {
    lightboxImage.src = images[currentIndex];
    lightboxCounter.textContent = hasMultiple ? `${currentIndex + 1} / ${images.length}` : '';
  }

  function openLightbox(index) {
    setMainImage(index);
    updateLightbox();
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
  }

  function showNext() {
    setMainImage((currentIndex + 1) % images.length);
    updateLightbox();
  }

  function showPrev() {
    setMainImage((currentIndex - 1 + images.length) % images.length);
    updateLightbox();
  }

  main.addEventListener('click', () => openLightbox(currentIndex));
  lightboxClose.addEventListener('click', closeLightbox);
  lightboxNext.addEventListener('click', showNext);
  lightboxPrev.addEventListener('click', showPrev);

  // Клик по тёмному фону (мимо фото и кнопок) закрывает лайтбокс.
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight' && hasMultiple) showNext();
    if (e.key === 'ArrowLeft' && hasMultiple) showPrev();
  });
});

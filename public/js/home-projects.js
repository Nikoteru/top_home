(() => {
  const section = document.querySelector('.home-projects');
  const track = section.querySelector('.home-projects__track');
  const cards = [...track.children];
  const controls = section.querySelector('.home-projects__controls');
  const pagination = section.querySelector('.home-projects__pagination');
  const positions = pagination.querySelector('.home-projects__positions');
  const position = pagination.querySelector('.home-projects__position');
  const previous = controls.querySelector('[data-project-step="-1"]');
  const next = controls.querySelector('[data-project-step="1"]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let pages = [];
  let width = 0;
  let active = 0;
  let requested = null;

  function showActive(index) {
    active = index;
    for (const [i, button] of [...positions.children].entries()) {
      if (i === active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    previous.setAttribute('aria-disabled', String(active === 0));
    next.setAttribute('aria-disabled', String(active === pages.length - 1));
    position.textContent = `${String(active + 1).padStart(2, '0')} / ${String(pages.length).padStart(2, '0')}`;
  }

  function goTo(index) {
    const target = Math.max(0, Math.min(index, pages.length - 1));
    if (target === (requested ?? active)) return;
    requested = target;
    track.scrollTo({ left: pages[target], behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  function syncPosition() {
    const offset = track.scrollLeft;
    const nearest = pages.reduce((best, page, index) => (
      Math.abs(page - offset) < Math.abs(pages[best] - offset) ? index : best
    ), 0);
    if (requested !== null && Math.abs(pages[requested] - offset) < 2) requested = null;
    if (nearest !== active) showActive(nearest);
  }

  function measure() {
    if (width === track.clientWidth) return;
    width = track.clientWidth;
    const end = track.scrollWidth - width;
    const start = cards[0].getBoundingClientRect().left;
    pages = cards.map((card) => Math.min(end, card.getBoundingClientRect().left - start))
      .filter((page, index, offsets) => index === 0 || page - offsets[index - 1] > 1);

    requested = null;
    const index = Math.min(active, pages.length - 1);
    track.scrollTo({ left: pages[index], behavior: 'auto' });
    controls.hidden = pages.length < 2;
    pagination.hidden = controls.hidden;
    if (controls.hidden) track.removeAttribute('tabindex');
    else track.tabIndex = 0;

    if (positions.children.length !== pages.length) {
      positions.replaceChildren(...pages.map((_, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', `Проекты, позиция ${i + 1} из ${pages.length}`);
        button.setAttribute('aria-controls', track.id);
        button.addEventListener('click', () => goTo(i));
        return button;
      }));
    }
    showActive(index);
  }

  previous.addEventListener('click', () => goTo((requested ?? active) - 1));
  next.addEventListener('click', () => goTo((requested ?? active) + 1));
  track.addEventListener('scroll', syncPosition, { passive: true });
  for (const event of ['pointerdown', 'wheel', 'scrollend']) {
    track.addEventListener(event, () => { requested = null; }, { passive: true });
  }
  track.addEventListener('keydown', (event) => {
    if (event.target !== track || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = requested ?? active;
    const targets = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: pages.length - 1 };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    goTo(targets[event.key]);
  });

  section.dataset.carouselReady = '';
  measure();
  new ResizeObserver(measure).observe(track);
})();

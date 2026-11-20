// Характеристики и диапазон отправляются в общий серверный подбор.
document.addEventListener('DOMContentLoaded', () => {
  const configEl = document.getElementById('calcConfig');
  if (!configEl) return;
  const { area: limits, filters: initial } = JSON.parse(configEl.textContent);
  const form = document.getElementById('calcForm');
  const minInput = document.getElementById('calcAreaMin');
  const maxInput = document.getElementById('calcAreaMax');
  const minRange = document.getElementById('calcAreaMinRange');
  const maxRange = document.getElementById('calcAreaMaxRange');
  const fill = document.getElementById('calcAreaFill');
  const results = document.getElementById('calcMatchResults');
  const status = document.getElementById('calcRequestStatus');
  const mobileCount = document.getElementById('calcMobileCount');
  const calcField = document.getElementById('calcField');
  let areaMin = initial.areaMin;
  let areaMax = initial.areaMax;
  let timer;
  let controller;
  let generation = 0;

  function filters() {
    const selection = {};
    form.querySelectorAll('.calc-option__input:checked').forEach((input) => {
      if (input.value) (selection[input.dataset.blockId] ||= []).push(input.value);
    });
    return { areaMin, areaMax, selection };
  }

  function queryFor(value) {
    const query = new URLSearchParams({ areaMin: value.areaMin, areaMax: value.areaMax });
    Object.entries(value.selection).forEach(([block, ids]) => ids.forEach((id) => query.append(`block-${block}`, id)));
    return query;
  }

  function syncArea() {
    minInput.value = minRange.value = areaMin;
    maxInput.value = maxRange.value = areaMax;
    const span = limits.max - limits.min;
    fill.style.left = `${100 * (areaMin - limits.min) / span}%`;
    fill.style.right = `${100 * (limits.max - areaMax) / span}%`;
    minRange.style.zIndex = areaMin === limits.max ? '3' : '';
  }

  function updateLead() {
    if (calcField) calcField.value = JSON.stringify(filters());
  }

  async function updateResults(value, version) {
    controller = new AbortController();
    const query = queryFor(value);
    status.textContent = 'Подбираем проекты…';
    results.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/calculator/matches?${query}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Could not load project matches');
      const html = await response.text();
      if (version !== generation) return;
      results.innerHTML = html;
      mobileCount.textContent = `Найдено: ${results.querySelector('[data-match-count]').dataset.matchCount}`;
      status.textContent = '';
      const url = new URL(window.location.href);
      url.search = query.toString();
      history.replaceState(null, '', url);
    } catch (error) {
      if (error.name !== 'AbortError' && version === generation) {
        status.textContent = 'Не удалось обновить подбор. Попробуйте ещё раз.';
      }
    } finally {
      if (version === generation) results.setAttribute('aria-busy', 'false');
    }
  }

  function schedule(delay = 200) {
    clearTimeout(timer);
    controller?.abort();
    const version = ++generation;
    const value = filters();
    updateLead();
    timer = setTimeout(() => updateResults(value, version), delay);
  }

  function commitArea(source) {
    const bound = (value, fallback) => value === '' || !Number.isFinite(Number(value))
      ? fallback : Math.min(limits.max, Math.max(limits.min, Math.round(Number(value))));
    areaMin = bound(minInput.value, areaMin);
    areaMax = bound(maxInput.value, areaMax);
    if (areaMin > areaMax) {
      if (source === 'min') areaMax = areaMin;
      else areaMin = areaMax;
    }
    syncArea();
    schedule(0);
  }

  minRange.addEventListener('input', () => {
    areaMin = Math.min(Number(minRange.value), areaMax);
    syncArea();
    schedule();
  });
  maxRange.addEventListener('input', () => {
    areaMax = Math.max(Number(maxRange.value), areaMin);
    syncArea();
    schedule();
  });
  [minInput, maxInput].forEach((input) => {
    input.addEventListener('input', () => {
      const from = Number(minInput.value);
      const to = Number(maxInput.value);
      if (!minInput.value || !maxInput.value || from < limits.min || to > limits.max || from > to) return;
      areaMin = Math.round(from);
      areaMax = Math.round(to);
      syncArea();
      schedule();
    });
    input.addEventListener('change', () => commitArea(input === minInput ? 'min' : 'max'));
  });
  form.addEventListener('change', (event) => {
    if (event.target.classList.contains('calc-option__input')) schedule(0);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    commitArea('max');
    if (window.matchMedia('(max-width: 960px)').matches) {
      document.getElementById('calcMatches').scrollIntoView({ behavior: 'smooth' });
    }
  });
  document.addEventListener('click', (event) => {
    const reset = event.target.closest('[data-calc-reset]');
    if (!reset) return;
    event.preventDefault();
    areaMin = limits.min;
    areaMax = limits.max;
    form.querySelectorAll('.calc-option__input').forEach((input) => { input.checked = input.type === 'radio' && !input.value; });
    syncArea();
    schedule(0);
  });

  const bar = document.getElementById('calcMobileBar');
  if (bar && 'IntersectionObserver' in window) {
    const visible = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target));
      bar.classList.toggle('is-hidden', visible.size > 0);
    });
    observer.observe(document.getElementById('calcMatches'));
    observer.observe(document.getElementById('form'));
  }
  syncArea();
  updateLead();
  document.getElementById('calcAreaSlider').hidden = false;
});

(() => {
  const header = document.querySelector('.admin-header');
  const toggles = [...header.querySelectorAll('button[aria-expanded]')];
  const isOpen = (toggle) => toggle.getAttribute('aria-expanded') === 'true';

  function close(toggle) {
    toggle?.setAttribute('aria-expanded', 'false');
  }

  for (const toggle of toggles) {
    toggle.addEventListener('click', () => {
      const wasOpen = isOpen(toggle);
      close(toggles.find(isOpen));
      if (!wasOpen) toggle.setAttribute('aria-expanded', 'true');
    });
  }

  function dismissOutside(event) {
    const toggle = toggles.find(isOpen);
    if (!toggle) return;
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!toggle.contains(event.target) && !panel.contains(event.target)) close(toggle);
  }

  document.addEventListener('click', dismissOutside);
  document.addEventListener('focusin', dismissOutside);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const toggle = toggles.find(isOpen);
    if (!toggle) return;
    event.preventDefault();
    close(toggle);
    toggle.focus();
  });
  window.addEventListener('resize', () => {
    const toggle = toggles.find(isOpen);
    if (toggle?.offsetParent === null) close(toggle);
  });

  header.dataset.menuReady = '';
})();

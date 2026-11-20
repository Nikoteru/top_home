(() => {
  const block = document.querySelector('[data-house-inclusions]');
  const tabList = block?.querySelector('[data-inclusion-tabs]');
  if (!tabList) return;

  const tabs = [...tabList.querySelectorAll('[data-inclusion-tab]')];
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
  if (!tabs.length || panels.some((panel) => !panel)) return;

  function selectTab(index) {
    tabs.forEach((tab, position) => {
      const active = position === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[position].hidden = !active;
    });
  }

  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-orientation', 'vertical');
  tabs.forEach((tab, index) => {
    tab.setAttribute('role', 'tab');
    const panel = panels[index];
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    tab.addEventListener('click', () => selectTab(index));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectTab(next);
      tabs[next].focus();
    });
  });
  selectTab(Math.max(0, tabs.findIndex((tab) => tab.hasAttribute('data-inclusion-active'))));
  block.classList.add('has-tabs');
  tabList.hidden = false;
})();

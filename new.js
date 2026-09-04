(function () {
  const menu = document.getElementById('more-menu');
  const toggle = document.getElementById('more-menu-toggle');
  const panel = document.getElementById('more-menu-panel');
  if (!menu || !toggle || !panel) return;

  function closeMenu() {
    panel.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    panel.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('hidden')) openMenu();
    else closeMenu();
  });

  panel.addEventListener('click', (e) => {
    const item = e.target.closest('.more-menu__item');
    if (!item) return;
    // Keep menu open only for disabled items
    if (item.disabled) {
      e.preventDefault();
      return;
    }
    closeMenu();
  });

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
})();

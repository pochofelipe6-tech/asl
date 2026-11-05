const snowToggle = document.querySelector<HTMLButtonElement>('#snowToggle');
const snowLayer = document.querySelector<HTMLDivElement>('#snowLayer');

if (snowToggle && snowLayer) {
  snowToggle.addEventListener('click', () => {
    const active = snowToggle.getAttribute('aria-pressed') !== 'true';
    snowToggle.setAttribute('aria-pressed', String(active));
    const label = active ? 'Desactivar nieve' : 'Activar nieve';
    snowToggle.setAttribute('aria-label', label);
    snowToggle.title = label;
    snowLayer.hidden = !active;
    snowLayer.replaceChildren();

    if (!active) return;

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const count = reducedMotion ? 14 : Math.min(65, Math.max(25, Math.round(innerWidth / 22)));
    const flakes = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const flake = document.createElement('span');
      flake.className = 'snowflake';
      flake.textContent = '\u2744';
      flake.style.left = `${Math.random() * 100}%`;
      flake.style.fontSize = `${8 + Math.random() * 10}px`;
      flake.style.opacity = `${0.85 + Math.random() * 0.15}`;
      const duration = (reducedMotion ? 22 : 8) + Math.random() * 10;
      flake.style.animationDuration = `${duration}s`;
      flake.style.animationDelay = `${-Math.random() * duration}s`;
      flake.style.setProperty('--snow-drift', `${Math.random() * 100 - 50}px`);
      flakes.append(flake);
    }
    snowLayer.append(flakes);
  });
}

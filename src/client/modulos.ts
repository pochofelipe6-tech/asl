const nombre = document.getElementById('userName');
const estado = document.getElementById('sessionStatus');
const tema = document.getElementById('themeToggle');
const etiquetaTema = document.getElementById('themeLabel');
function aplicarTema() {
  const claro = document.documentElement.dataset.tema === 'claro';
  const texto = claro ? 'Modo oscuro' : 'Modo claro';
  tema?.setAttribute('aria-pressed', String(claro));
  if (etiquetaTema) etiquetaTema.textContent = texto;
  else if (tema) tema.textContent = texto;
}
aplicarTema();
if (tema) {
  tema.addEventListener('click', () => {
    const claro = document.documentElement.dataset.tema !== 'claro';
    // Misma animación del bombillo que en el índice de frescura.
    const bombillo = tema.querySelector<HTMLElement>('.theme-bulb');
    if (bombillo) {
      bombillo.classList.remove('bulb-turning-on', 'bulb-turning-off');
      void bombillo.offsetWidth;
      bombillo.classList.add(claro ? 'bulb-turning-on' : 'bulb-turning-off');
    }
    document.documentElement.dataset.tema = claro ? 'claro' : 'oscuro';
    try { localStorage.setItem('frescura-tema', claro ? 'claro' : 'oscuro'); } catch { /* Almacenamiento opcional. */ }
    aplicarTema();
  });
}
// Brillo que sigue al puntero sobre cada tarjeta de módulo.
for (const tarjeta of document.querySelectorAll<HTMLElement>('.module-card')) {
  tarjeta.addEventListener('pointermove', evento => {
    const caja = tarjeta.getBoundingClientRect();
    tarjeta.style.setProperty('--mx', `${evento.clientX - caja.left}px`);
    tarjeta.style.setProperty('--my', `${evento.clientY - caja.top}px`);
  });
}
document.getElementById('logout')?.addEventListener('click', async () => {
  try {
    const respuesta = await fetch('/api/logout', { method: 'POST' });
    if (!respuesta.ok) throw new Error();
    location.href = '/';
  } catch {
    if (estado) estado.textContent = 'No se pudo cerrar sesión. Inténtalo de nuevo.';
  }
});
async function cargarUsuario() {
  try {
    const respuesta = await fetch('/api/me');
    if (respuesta.status === 401) { location.replace('/'); return; }
    if (!respuesta.ok) throw new Error();
    const usuario = await respuesta.json();
    if (nombre) nombre.textContent = usuario.nombre;
  } catch {
    if (estado) estado.textContent = 'No se pudo consultar la sesión. Recarga la página para reintentar.';
  }
}
void cargarUsuario();

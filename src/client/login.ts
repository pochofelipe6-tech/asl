import { porId } from './dom';
import { salidaFormulario } from './salida';
import './snow';

const form = porId<HTMLFormElement>('form');
const correo = porId<HTMLInputElement>('correo');
const pass = porId<HTMLInputElement>('password');
const alertBox = porId('alert');
const submitBtn = porId<HTMLButtonElement>('submitBtn');
const submitLabel = porId('submitLabel');

const VACIO: Record<string, string> = { correo: 'Escribe tu correo.', password: 'Escribe tu contraseña.' };

function validate(el: HTMLInputElement): boolean {
  let error = '';
  if (el.value.trim() === '') error = VACIO[el.id] ?? '';
  else if (el.type === 'email' && !el.validity.valid) error = 'Escribe un correo válido, por ejemplo nombre@gmail.com.';

  porId(el.id + '-error').textContent = error;
  el.closest('.field')?.classList.toggle('invalid', !!error);
  el.setAttribute('aria-invalid', String(!!error));
  el.setAttribute('aria-describedby', error ? el.id + '-error' : '');
  return !error;
}

function showAlert(message: string) {
  alertBox.textContent = message;
  alertBox.classList.add('show');
}

// Quitar el error en cuanto el usuario empieza a corregir
[correo, pass].forEach(el => el.addEventListener('input', () => {
  if (el.closest('.field')?.classList.contains('invalid')) validate(el);
  alertBox.classList.remove('show');
}));

// Mostrar / ocultar contraseña (el ojo y el texto "Mostrar contraseña" hacen lo mismo)
const eyeBtn = porId<HTMLButtonElement>('togglePass');
const toggleText = porId<HTMLButtonElement>('togglePassText');
function togglePassword() {
  const show = pass.type === 'password';
  pass.type = show ? 'text' : 'password';
  eyeBtn.classList.toggle('is-visible', show);
  eyeBtn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  toggleText.textContent = show ? 'Ocultar contraseña' : 'Mostrar contraseña';
  pass.focus();
}
[eyeBtn, toggleText].forEach(btn => btn.addEventListener('click', togglePassword));

// Si el sistema pide reducir animaciones, el camión se queda quieto donde está en el diseño
// (al 60,5 % de la ruta: 0,605 × 16 s de animación)
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const ruta = document.querySelector<SVGSVGElement>('#ruta-animada');
  ruta?.setCurrentTime(9.68);
  ruta?.pauseAnimations();
}

// Aviso de Bloq Mayús
const caps = porId('caps');
const avisoMayus = (e: KeyboardEvent) => caps.classList.toggle('show', e.getModifierState('CapsLock'));
pass.addEventListener('keydown', avisoMayus);
pass.addEventListener('keyup', avisoMayus);
pass.addEventListener('blur', () => caps.classList.remove('show'));

// Al volver con «atrás», el navegador puede restaurar la página tal como quedó tras la
// animación de salida (sin formulario): se recarga para que el servidor decida qué mostrar
window.addEventListener('pageshow', e => {
  if (e.persisted) location.reload();
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  alertBox.classList.remove('show');

  const valid = [correo, pass].map(validate).every(Boolean);
  if (!valid) {
    form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
    return;
  }

  submitBtn.disabled = true;
  submitLabel.textContent = 'Entrando…';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo: correo.value.trim(), password: pass.value }),
    });

    if (res.ok) {
      const card = form.closest<HTMLElement>('.card');
      if (card) await salidaFormulario(card);
      location.href = '/panel';
      return;
    }

    const data: { error?: string } = await res.json().catch(() => ({}));
    showAlert(data.error || 'No se pudo iniciar sesión. Inténtalo de nuevo.');
    pass.value = '';
    pass.focus();
  } catch {
    showAlert('No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.');
  }

  submitBtn.disabled = false;
  submitLabel.textContent = 'Entrar';
});

// Solo se marca listo cuando el controlador de envio ya esta instalado.
form.dataset.ready = 'true';

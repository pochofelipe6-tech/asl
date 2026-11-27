import { porId } from './dom';
import { salidaFormulario } from './salida';
import { errorCedula, errorClave, errorNombre, normalizarCedula, normalizarNombre } from '../shared/usuarios';
import './snow';

// Ingreso con cédula y contraseña. Tres momentos en la misma tarjeta:
// - "ingreso": cédula y contraseña.
// - "cambio": el administrador restableció la contraseña (temporal): además se pide crear una nueva.
// - "registro": cédula, nombre y contraseña; la cuenta queda pendiente hasta que un administrador la apruebe.
type Modo = 'ingreso' | 'cambio' | 'registro';

const form = porId<HTMLFormElement>('form');
const formRegistro = porId<HTMLFormElement>('formRegistro');
const cedula = porId<HTMLInputElement>('cedula');
const pass = porId<HTMLInputElement>('password');
const bloqueNueva = porId('bloqueNueva');
const nueva = porId<HTMLInputElement>('nueva');
const nuevaConfirmar = porId<HTMLInputElement>('nuevaConfirmar');
const regCedula = porId<HTMLInputElement>('regCedula');
const regNombre = porId<HTMLInputElement>('regNombre');
const regClave = porId<HTMLInputElement>('regClave');
const regConfirmar = porId<HTMLInputElement>('regConfirmar');
const alertBox = porId('alert');
const submitBtn = porId<HTMLButtonElement>('submitBtn');
const submitLabel = porId('submitLabel');
const registroBtn = porId<HTMLButtonElement>('registroBtn');
const registroLabel = porId('registroLabel');
const titulo = porId('titulo');
const subtitulo = porId('subtitulo');

let modo: Modo = 'ingreso';

/** Qué falta o está mal en cada campo (vacío si está bien). */
function problemaDe(el: HTMLInputElement): string {
  const v = el.value;
  switch (el.id) {
    case 'cedula': case 'regCedula': return errorCedula(normalizarCedula(v)) ?? '';
    case 'password': return v ? '' : 'Escribe tu contraseña.';
    case 'regNombre': return errorNombre(normalizarNombre(v)) ?? '';
    case 'regClave': return errorClave(v, normalizarCedula(regCedula.value)) ?? '';
    case 'regConfirmar': return v === regClave.value ? '' : 'Las contraseñas no coinciden.';
    case 'nueva': return errorClave(v, normalizarCedula(cedula.value)) ?? (v && v === pass.value ? 'Debe ser distinta a la contraseña temporal.' : '');
    case 'nuevaConfirmar': return v === nueva.value ? '' : 'Las contraseñas no coinciden.';
    default: return '';
  }
}
function validate(el: HTMLInputElement): boolean {
  const error = problemaDe(el);
  porId(el.id + '-error').textContent = error;
  el.closest('.field')?.classList.toggle('invalid', !!error);
  el.setAttribute('aria-invalid', String(!!error));
  el.setAttribute('aria-describedby', error ? el.id + '-error' : '');
  return !error;
}

function showAlert(message: string, ok = false) {
  alertBox.textContent = message;
  alertBox.classList.toggle('ok', ok);
  alertBox.setAttribute('role', ok ? 'status' : 'alert');
  alertBox.classList.add('show');
}
const ocultarAlerta = () => alertBox.classList.remove('show', 'ok');

function ponerModo(nuevo: Modo) {
  modo = nuevo;
  const registro = modo === 'registro';
  form.hidden = registro;
  formRegistro.hidden = !registro;
  bloqueNueva.hidden = modo !== 'cambio';
  nueva.required = nuevaConfirmar.required = modo === 'cambio';
  const [t, resalte, sub] = registro
    ? ['Crear ', 'cuenta', 'Regístrate con tu cédula. Un administrador aprobará tu cuenta antes de que puedas entrar.']
    : modo === 'cambio'
      ? ['Nueva ', 'contraseña', 'Tu contraseña fue restablecida. Crea una nueva para entrar.']
      : ['Iniciar ', 'sesión', 'Ingresa con tu número de cédula y tu contraseña.'];
  const span = document.createElement('span');
  span.className = 'resalte';
  span.textContent = resalte;
  titulo.replaceChildren(t, span);
  subtitulo.textContent = sub;
  submitLabel.textContent = modo === 'cambio' ? 'Guardar y entrar' : 'Entrar';
  for (const el of [...form.querySelectorAll('input'), ...formRegistro.querySelectorAll('input')]) {
    el.closest('.field')?.classList.remove('invalid');
    el.setAttribute('aria-invalid', 'false');
  }
}

// Quitar el error en cuanto el usuario empieza a corregir.
for (const el of [cedula, pass, nueva, nuevaConfirmar, regCedula, regNombre, regClave, regConfirmar]) {
  el.addEventListener('input', () => {
    if (el.closest('.field')?.classList.contains('invalid')) validate(el);
    ocultarAlerta();
  });
}

porId('irRegistro').addEventListener('click', () => {
  ocultarAlerta();
  ponerModo('registro');
  if (!regCedula.value && cedula.value) regCedula.value = cedula.value;
  (regCedula.value ? regNombre : regCedula).focus();
});
porId('irIngreso').addEventListener('click', () => {
  ocultarAlerta();
  ponerModo('ingreso');
  cedula.focus();
});

// Mostrar / ocultar contraseña (el ojo y el texto "Mostrar contraseña" hacen lo mismo).
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
// Los demás ojos (nueva contraseña y registro): muestran su campo y el de "repite".
for (const ojo of document.querySelectorAll<HTMLButtonElement>('.eye[data-para]')) {
  ojo.addEventListener('click', () => {
    const campo = porId<HTMLInputElement>(ojo.dataset.para!);
    const show = campo.type === 'password';
    const pareja = campo === nueva ? nuevaConfirmar : campo === regClave ? regConfirmar : null;
    for (const el of [campo, pareja]) if (el) el.type = show ? 'text' : 'password';
    ojo.classList.toggle('is-visible', show);
    ojo.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    campo.focus();
  });
}

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

const SIN_CONEXION = 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
const primeroInvalido = (f: HTMLFormElement) => f.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();

form.addEventListener('submit', async e => {
  e.preventDefault();
  ocultarAlerta();
  const campos = modo === 'cambio' ? [cedula, pass, nueva, nuevaConfirmar] : [cedula, pass];
  if (!campos.map(validate).every(Boolean)) { primeroInvalido(form); return; }

  submitBtn.disabled = true;
  submitLabel.textContent = modo === 'cambio' ? 'Guardando…' : 'Entrando…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cedula: normalizarCedula(cedula.value), password: pass.value, ...(modo === 'cambio' ? { nueva: nueva.value } : {}) }),
    });
    if (res.ok) {
      const card = form.closest<HTMLElement>('.card');
      if (card) await salidaFormulario(card);
      location.href = '/modulos';
      return;
    }
    const data: { error?: string; code?: string } = await res.json().catch(() => ({}));
    if (data.code === 'DEBE_CAMBIAR') {
      // Contraseña temporal correcta: ahora se pide la nueva (la temporal se queda escrita).
      if (modo !== 'cambio') { ponerModo('cambio'); showAlert(data.error || 'Crea una nueva contraseña para continuar.', true); nueva.focus(); }
      else { showAlert(data.error || 'Revisa la nueva contraseña.'); nueva.focus(); }
    } else {
      showAlert(data.error || 'No se pudo iniciar sesión. Inténtalo de nuevo.');
      if (modo === 'cambio') ponerModo('ingreso');
      pass.value = '';
      pass.focus();
    }
  } catch {
    showAlert(SIN_CONEXION);
  }
  submitBtn.disabled = false;
  submitLabel.textContent = modo === 'cambio' ? 'Guardar y entrar' : 'Entrar';
});

formRegistro.addEventListener('submit', async e => {
  e.preventDefault();
  ocultarAlerta();
  if (![regCedula, regNombre, regClave, regConfirmar].map(validate).every(Boolean)) { primeroInvalido(formRegistro); return; }
  registroBtn.disabled = true;
  registroLabel.textContent = 'Enviando…';
  try {
    const res = await fetch('/api/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cedula: normalizarCedula(regCedula.value), nombre: normalizarNombre(regNombre.value), password: regClave.value }),
    });
    const data: { error?: string; mensaje?: string } = await res.json().catch(() => ({}));
    if (res.ok) {
      // Listo: vuelve al ingreso con la cédula escrita y el aviso de que falta la aprobación.
      cedula.value = normalizarCedula(regCedula.value);
      formRegistro.reset();
      ponerModo('ingreso');
      showAlert(data.mensaje || 'Registro enviado. Cuando un administrador lo apruebe podrás entrar.', true);
      pass.focus();
    } else showAlert(data.error || 'No se pudo registrar. Inténtalo de nuevo.');
  } catch {
    showAlert(SIN_CONEXION);
  }
  registroBtn.disabled = false;
  registroLabel.textContent = 'Crear cuenta';
});

ponerModo('ingreso');
// Solo se marca listo cuando el controlador de envio ya esta instalado.
form.dataset.ready = 'true';

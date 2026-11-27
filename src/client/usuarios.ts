// Panel de usuarios (solo administradores): aprobar registros, asignar roles, desactivar y restablecer contraseñas.
// Los datos y las reglas están en el servidor (src/server/usuarios.ts); aquí solo se muestran y se piden los cambios.
import { porId } from './dom';
import { DETALLE_ROL, NOMBRE_ESTADO, NOMBRE_ROL, ROLES, type Estado, type Rol, type UsuarioPanel } from '../shared/usuarios';

type Filtro = Estado | 'todos';
const TITULOS: Record<Filtro, string> = {
  pendiente: 'Pendientes de aprobación', activo: 'Usuarios activos', inactivo: 'Usuarios desactivados', rechazado: 'Registros rechazados', todos: 'Todos los usuarios',
};

const cuerpo = porId<HTMLTableSectionElement>('usCuerpo');
const buscar = porId<HTMLInputElement>('usBuscar');
const mensaje = porId('usMensaje');
const vacio = porId('usVacio');
let usuarios: UsuarioPanel[] = [];
let filtro: Filtro = 'pendiente';
let miCedula = '';
let cargado = false;

function crear<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}
const formatoMomento = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
const momento = (v: string | null) => (v ? formatoMomento.format(new Date(v)) : '—');
const cedulaBonita = (c: string) => Number(c).toLocaleString('es-CO');

let ocultarMensaje = 0;
function avisar(texto: string, tipo: 'ok' | 'error' = 'ok') {
  mensaje.textContent = texto;
  mensaje.dataset.tipo = tipo;
  mensaje.hidden = false;
  clearTimeout(ocultarMensaje);
  ocultarMensaje = window.setTimeout(() => { mensaje.hidden = true; }, tipo === 'ok' ? 6000 : 9000);
}

// ---------- Ventana de confirmación ----------
const dialogo = porId<HTMLDialogElement>('usDialogo');
const temporalCaja = porId('usTemporal');
const temporalClave = porId('usTemporalClave');
function confirmar(titulo: string, texto: string, si = 'Confirmar', peligro = false): Promise<boolean> {
  porId('usDialogoTitulo').textContent = titulo;
  porId('usDialogoTexto').textContent = texto;
  temporalCaja.hidden = true;
  const botonSi = porId<HTMLButtonElement>('usDialogoSi');
  botonSi.textContent = si;
  botonSi.classList.toggle('us-peligro', peligro);
  porId('usDialogoNo').hidden = false;
  dialogo.returnValue = '';
  dialogo.showModal();
  return new Promise(resolver => dialogo.addEventListener('close', () => resolver(dialogo.returnValue === 'si'), { once: true }));
}
function mostrarTemporal(nombre: string, clave: string) {
  porId('usDialogoTitulo').textContent = 'Contraseña temporal';
  porId('usDialogoTexto').textContent = `Entrégasela a ${nombre}. Al entrar con su cédula y esta contraseña, deberá crear la suya. Solo se muestra esta vez.`;
  temporalClave.textContent = clave;
  temporalCaja.hidden = false;
  const botonSi = porId<HTMLButtonElement>('usDialogoSi');
  botonSi.textContent = 'Listo';
  botonSi.classList.remove('us-peligro');
  porId('usDialogoNo').hidden = true;
  dialogo.showModal();
}
porId('usCopiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(temporalClave.textContent ?? '');
    porId('usCopiar').textContent = 'Copiada';
  } catch {
    getSelection()?.selectAllChildren(temporalClave);
  }
});
dialogo.addEventListener('close', () => { porId('usCopiar').textContent = 'Copiar'; });

// ---------- Datos ----------
async function cargar() {
  const boton = porId<HTMLButtonElement>('usActualizar');
  boton.disabled = true;
  try {
    const [yo, lista] = await Promise.all([fetch('/api/me'), fetch('/api/usuarios')]);
    if (yo.status === 401 || lista.status === 401) { location.replace('/'); return; }
    if (lista.status === 403) { location.replace('/modulos'); return; }
    const datos = await lista.json().catch(() => ({}));
    if (!lista.ok) throw new Error(datos.error || 'No se pudieron consultar los usuarios.');
    miCedula = String((await yo.json().catch(() => ({}))).cedula ?? '');
    usuarios = datos.usuarios ?? [];
    // La primera vez se abren los pendientes si hay; si no, los activos.
    if (!cargado) filtro = usuarios.some(u => u.estado === 'pendiente') ? 'pendiente' : 'activo';
    cargado = true;
    pintar();
  } catch (error) {
    avisar(error instanceof TypeError ? 'No hay conexión con el servidor. Revisa tu red.' : (error as Error).message, 'error');
  } finally {
    boton.disabled = false;
  }
}

async function cambiar(u: UsuarioPanel, accion: string, rol?: Rol) {
  try {
    const respuesta = await fetch(`/api/usuarios/${encodeURIComponent(u.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, ...(rol ? { rol } : {}) }),
    });
    if (respuesta.status === 401) { location.replace('/'); return; }
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) { avisar(datos.error || 'No se pudo guardar el cambio.', 'error'); pintar(); return; }
    const i = usuarios.findIndex(x => x.id === u.id);
    if (datos.usuario) usuarios[i] = datos.usuario; else usuarios.splice(i, 1);
    const hecho: Record<string, string> = {
      aprobar: `${u.nombre} quedó aprobado como ${NOMBRE_ROL[rol ?? 'usuario']}. Ya puede entrar con su cédula.`,
      rechazar: `Se rechazó el registro de ${u.nombre}.`,
      desactivar: `${u.nombre} quedó desactivado: ya no puede entrar.`,
      activar: `${u.nombre} puede volver a entrar.`,
      rol: `${u.nombre} ahora es ${NOMBRE_ROL[rol ?? 'usuario']}.`,
      eliminar: `Se borró el registro de ${u.nombre}; su cédula puede registrarse de nuevo.`,
      restablecer: `Se restableció la contraseña de ${u.nombre}.`,
    };
    avisar(hecho[accion] ?? 'Cambio guardado.');
    pintar();
    if (accion === 'restablecer' && datos.temporal) mostrarTemporal(u.nombre, datos.temporal);
  } catch {
    avisar('No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.', 'error');
  }
}

// ---------- Pintar ----------
function selectorRol(u: UsuarioPanel, alCambiar?: (rol: Rol) => void): HTMLSelectElement {
  const select = crear('select', 'us-rol');
  select.setAttribute('aria-label', `Rol de ${u.nombre}`);
  for (const r of ROLES) {
    const opcion = new Option(NOMBRE_ROL[r], r, false, r === u.rol);
    opcion.title = DETALLE_ROL[r];
    select.append(opcion);
  }
  if (alCambiar) select.addEventListener('change', () => alCambiar(select.value as Rol));
  return select;
}
function boton(texto: string, clase: string, accion: () => void): HTMLButtonElement {
  const b = crear('button', clase, texto);
  b.type = 'button';
  b.addEventListener('click', accion);
  return b;
}

function accionesDe(u: UsuarioPanel, esYo: boolean): { rol: Node; acciones: Node[] } {
  if (u.estado === 'pendiente' || u.estado === 'rechazado') {
    const rol = selectorRol({ ...u, rol: 'usuario' });
    const acciones = [boton('Aprobar', 'aa-boton us-accion', () => void cambiar(u, 'aprobar', rol.value as Rol))];
    if (u.estado === 'pendiente') acciones.push(boton('Rechazar', 'aa-boton-sec us-accion', async () => {
      if (await confirmar('Rechazar registro', `${u.nombre} (cédula ${cedulaBonita(u.cedula)}) no podrá entrar. Después puedes aprobarlo o borrar el registro.`, 'Rechazar', true)) void cambiar(u, 'rechazar');
    }));
    else acciones.push(boton('Borrar registro', 'aa-boton-sec us-accion', async () => {
      if (await confirmar('Borrar registro', `Se borra el registro de ${u.nombre}. Su cédula podrá registrarse de nuevo.`, 'Borrar', true)) void cambiar(u, 'eliminar');
    }));
    return { rol, acciones };
  }
  if (esYo) return { rol: crear('span', 'us-rol-fijo', NOMBRE_ROL[u.rol]), acciones: [crear('span', 'us-tu', 'Esta es tu cuenta')] };
  const rol = selectorRol(u, async nuevo => {
    if (await confirmar('Cambiar rol', `${u.nombre} pasará a ser ${NOMBRE_ROL[nuevo]}. ${DETALLE_ROL[nuevo]}`, 'Cambiar rol')) void cambiar(u, 'rol', nuevo);
    else pintar();
  });
  const acciones = [boton('Restablecer contraseña', 'aa-boton-sec us-accion', async () => {
    if (await confirmar('Restablecer contraseña', `Se creará una contraseña temporal para ${u.nombre}. La actual dejará de funcionar.`, 'Restablecer')) void cambiar(u, 'restablecer');
  })];
  acciones.push(u.estado === 'activo'
    ? boton('Desactivar', 'aa-boton-sec us-accion us-peligro-sec', async () => {
      if (await confirmar('Desactivar usuario', `${u.nombre} no podrá entrar y su sesión abierta se cerrará en menos de un minuto. Puedes volver a activarlo cuando quieras.`, 'Desactivar', true)) void cambiar(u, 'desactivar');
    })
    : boton('Activar', 'aa-boton us-accion', () => void cambiar(u, 'activar')));
  return { rol, acciones };
}

function pintar() {
  const cuentas = { pendiente: 0, activo: 0, inactivo: 0, rechazado: 0 } as Record<Estado, number>;
  for (const u of usuarios) cuentas[u.estado]++;
  for (const e of ['pendiente', 'activo', 'inactivo', 'rechazado'] as const) {
    porId(`usCuenta${e[0].toUpperCase()}${e.slice(1)}`).textContent = String(cuentas[e]);
  }
  porId('usCuentaPendiente').classList.toggle('us-cuenta-alerta', cuentas.pendiente > 0);
  for (const b of document.querySelectorAll<HTMLButtonElement>('.us-pestanas [data-estado]')) b.setAttribute('aria-pressed', String(b.dataset.estado === filtro));

  const texto = buscar.value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');
  const digitos = texto.replace(/\D/g, '');
  const visibles = usuarios.filter(u => (filtro === 'todos' || u.estado === filtro)
    && (!texto || u.nombre.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '').includes(texto) || (!!digitos && u.cedula.includes(digitos))));
  porId('usTitulo').textContent = TITULOS[filtro];
  porId('usSub').textContent = `${visibles.length} de ${usuarios.length} ${usuarios.length === 1 ? 'usuario' : 'usuarios'}`;

  cuerpo.replaceChildren(...visibles.map(u => {
    const esYo = u.cedula === miCedula;
    const tr = crear('tr');
    const nombre = crear('td', 'us-nombre');
    nombre.append(crear('b', undefined, u.nombre));
    if (u.aprobado_por) nombre.append(crear('small', undefined, `Aprobado por ${u.aprobado_por}`));
    if (u.debe_cambiar) nombre.append(crear('small', 'us-nota', 'Con contraseña temporal'));
    const estado = crear('td');
    estado.append(crear('span', `us-estado us-estado-${u.estado}`, NOMBRE_ESTADO[u.estado]));
    const { rol, acciones } = accionesDe(u, esYo);
    const celdaRol = crear('td');
    celdaRol.append(rol);
    const celdaAcciones = crear('td', 'us-acciones');
    celdaAcciones.append(...acciones);
    tr.append(crear('td', 'us-cedula', cedulaBonita(u.cedula)), nombre, estado, celdaRol, crear('td', 'us-fecha', momento(u.creado_en)), crear('td', 'us-fecha', momento(u.ultimo_ingreso)), celdaAcciones);
    return tr;
  }));
  vacio.hidden = visibles.length > 0;
  vacio.textContent = texto ? 'Nadie coincide con la búsqueda.'
    : filtro === 'pendiente' ? 'No hay registros pendientes. Cuando alguien se registre, aparecerá aquí para que lo apruebes.'
      : 'No hay usuarios en esta lista.';
}

for (const b of document.querySelectorAll<HTMLButtonElement>('.us-pestanas [data-estado]')) {
  b.addEventListener('click', () => { filtro = b.dataset.estado as Filtro; pintar(); });
}
buscar.addEventListener('input', () => pintar());
porId('usActualizar').addEventListener('click', () => void cargar());
void cargar();

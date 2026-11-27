// Módulo Solicitudes de material.
// Nueva solicitud: formulario en tarjeta oscura, debajo la tabla de artículos por guardar (varios materiales
// se guardan juntos) y, al lado, el historial del centro elegido (últimas 5 solicitudes,
// lo pedido en el mes y un aviso si el mismo material ya se pidió en los últimos 7 días).
// Solicitudes: tablero con indicadores, barras por centro, top 5 de materiales y la tabla; los filtros mandan sobre todo.
// El solicitante sale del código del centro (ver src/shared/solicitudes.ts).
// Tema, usuario y cierre de sesión los maneja modulos.ts, cargado en la misma página.
import { porId } from './dom';
import { CENTROS_DESTINO, MATERIALES, MAX_LOTE, buscarCentro, codigoMaterial, leerCantidad, revisarSolicitud } from '../shared/solicitudes';
import type { CampoSolicitud, CentroDestino, Solicitud } from '../shared/solicitudes';

interface Registro { id: string; usuario_nombre: string; creado_en: string; respuestas: Partial<Solicitud> }

/** La tabla muestra las 10 solicitudes más recientes; las demás, con las flechas de página. */
const POR_PAGINA = 10;
const DIA = 86_400_000;
const CAMPOS: readonly CampoSolicitud[] = ['centro', 'material', 'cantidad', 'descripcion'];
const SIN_CONEXION = 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
const SVG = 'http://www.w3.org/2000/svg';
const TRAZOS = {
  persona: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5v-1a7 7 0 0 1 14 0v1"/>',
  caja: '<path d="m12 2.8 8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4L12 2.8Z"/><path d="m3.8 7.4 8.2 4.6 8.2-4.6M12 12v9.2"/>',
  editar: '<path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m14 6 4 4"/>',
  eliminar: '<path d="M4 7h16M9.5 7V4.5h5V7M6.2 7l.9 12.5h9.8L17.8 7M10 11v5M14 11v5"/>',
  chulo: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  menos: '<path d="M6.5 12h11"/>',
  equis: '<path d="M8 8l8 8M16 8l-8 8"/>',
  derecha: '<path d="m9 6 6 6-6 6"/>',
  personaLlena: '<circle cx="12" cy="7.5" r="4.2"/><path d="M3.8 21c0-4.6 3.7-7.6 8.2-7.6s8.2 3 8.2 7.6z"/>',
  pinLleno: '<path fill-rule="evenodd" d="M12 2.2a7.3 7.3 0 0 0-7.3 7.3c0 5.6 7.3 12.3 7.3 12.3s7.3-6.7 7.3-12.3A7.3 7.3 0 0 0 12 2.2zm0 10.1a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6z"/>',
  cuboLleno: '<path d="M12 2.3 20.3 7 12 11.6 3.7 7z"/><path d="M3 8.3v9.1l8.2 4.5v-9.1zM21 8.3l-8.2 4.5v9.1l8.2-4.5z"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  ver: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  alerta: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17h.01"/>',
  flecha: '<path d="M5 12h14M13 6l6 6-6 6"/>',
} as const;

let registros: Registro[] | null = null;
let truncado = false;
let fallaCarga = false;
let pagina = 0;
let cargando: Promise<void> | null = null;
/** Descripciones de materiales que no están en MATERIALES, tomadas de las solicitudes guardadas. */
let aprendidas = new Map<string, string>();

function crear<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

/** Ícono SVG decorativo. Los trazos son fijos del código, nunca datos de usuarios. */
function icono(trazos: string, clase = 'fm-ico'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', clase);
  svg.innerHTML = trazos;
  return svg;
}

function mostrarEstado(el: HTMLElement, texto: string, tipo: 'ok' | 'error' | '' = '') {
  el.textContent = texto;
  el.dataset.tipo = tipo;
}

const formatoFecha = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
const formatoCorta = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' });
const formatoHora = new Intl.DateTimeFormat('es-CO', { timeStyle: 'short' });
const formatoMes = new Intl.DateTimeFormat('es-CO', { month: 'long' });
const cifra = (n: number) => n.toLocaleString('es-CO');
const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const cdDe = (codigo: string | undefined) => CENTROS_DESTINO.find(c => c.codigo === codigo)?.cd ?? '';
const claveMes = (fecha: Date) => `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
/** Día local en el formato del campo de fecha: "2026-11-26". */
const claveDia = (fecha: Date) => `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
const fechaDeDia = (dia: string) => { const [anio, mes, d] = dia.split('-').map(Number); return new Date(anio, mes - 1, d); };
const sumarDias = (dia: string, n: number) => { const f = fechaDeDia(dia); f.setDate(f.getDate() + n); return claveDia(f); };
const formatoDiaSemana = new Intl.DateTimeFormat('es-CO', { weekday: 'long' });
const formatoDiaMes = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit' });
/** Cómo se nombra un día en el tablero: "Hoy", "Ayer" o el día de la semana. */
function nombreDia(dia: string): string {
  const hoy = claveDia(new Date());
  return dia === hoy ? 'Hoy' : dia === sumarDias(hoy, -1) ? 'Ayer' : mayuscula(formatoDiaSemana.format(fechaDeDia(dia)));
}
/** "de hoy", "de ayer" o "del 24/11", para los indicadores. */
function delDia(dia: string): string {
  const nombre = nombreDia(dia);
  return nombre === 'Hoy' ? 'de hoy' : nombre === 'Ayer' ? 'de ayer' : `del ${formatoDiaMes.format(fechaDeDia(dia))}`;
}
/** "hoy", "ayer" o "el 24/11/2026", para frases como "No hay solicitudes hoy". */
const enElDia = (dia: string) => { const n = nombreDia(dia); return n === 'Hoy' ? 'hoy' : n === 'Ayer' ? 'ayer' : `el ${formatoFecha.format(fechaDeDia(dia))}`; };
/** "Hoy, 26/11/2026" o "Martes, 24/11/2026"; sin fecha, "Todas las fechas". */
const tituloDia = (dia: string) => (dia ? `${nombreDia(dia)}, ${formatoFecha.format(fechaDeDia(dia))}` : 'Todas las fechas');
const describir = (r: Registro) => `${r.respuestas.solicitante ?? 'sin solicitante'} (${r.respuestas.centro ?? '—'})`;
const cantidadDe = (r: Registro) => (typeof r.respuestas.cantidad === 'number' ? r.respuestas.cantidad : 0);
const sumar = (lista: readonly Registro[]) => lista.reduce((t, r) => t + cantidadDe(r), 0);
const plural = (n: number, uno: string, varios: string) => `${cifra(n)} ${n === 1 ? uno : varios}`;
/** Más reciente primero. */
const ordenados = (lista: readonly Registro[]) => [...lista].sort((a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en));

/** Días de calendario entre la fecha y hoy (0 = hoy). */
function diasDesde(fecha: Date): number {
  const hoy = new Date();
  return Math.round((new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime() - new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime()) / DIA);
}

/** "hoy", "ayer" o "hace N días". */
function haceDias(fecha: Date): string {
  const dias = diasDesde(fecha);
  return dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`;
}

/** Respuesta de la API como mensaje para el usuario; si la sesión venció, vuelve al inicio de sesión. */
async function errorDeApi(respuesta: Response, porDefecto: string): Promise<string | null> {
  if (respuesta.status === 401) { location.replace('/'); return null; }
  const datos = await respuesta.json().catch(() => ({}));
  return datos.error || porDefecto;
}

// ---------- Campos del formulario (los usan el formulario principal y la ventana de edición) ----------

interface Campos {
  form: HTMLFormElement;
  entradas: Record<CampoSolicitud, HTMLInputElement>;
  infoCentro: HTMLElement;
  infoMaterial: HTMLElement;
  cajaDescripcion: HTMLElement;
  /** En la edición, la descripción de un material que no está en el catálogo se puede corregir. */
  corregible: boolean;
}

function armarCampos(form: HTMLFormElement, prefijo: 'so' | 'soe', corregible: boolean): Campos {
  const entrada = (nombre: CampoSolicitud) => form.elements.namedItem(nombre) as HTMLInputElement;
  return {
    form,
    entradas: { centro: entrada('centro'), material: entrada('material'), cantidad: entrada('cantidad'), descripcion: entrada('descripcion') },
    infoCentro: porId(`${prefijo}CentroInfo`),
    infoMaterial: porId(`${prefijo}MaterialInfo`),
    cajaDescripcion: form.querySelector<HTMLElement>('[data-campo="descripcion"]')!,
    corregible,
  };
}

/** Descripción que no se escribe: la del catálogo o, en el formulario principal, la aprendida. */
// En el formulario principal también vale la descripción escrita para un artículo que ya está en la tabla.
const descripcionFija = (c: Campos, material: string) => MATERIALES[material]
  ?? (c.corregible ? undefined : aprendidas.get(material) ?? articulos.find(a => a.material === material)?.descripcion);

function datosDe(c: Campos) {
  const material = codigoMaterial(c.entradas.material.value);
  return {
    centro: c.entradas.centro.value,
    material: c.entradas.material.value,
    descripcion: (material && descripcionFija(c, material)) || c.entradas.descripcion.value,
    cantidad: c.entradas.cantidad.value,
  };
}

function marcar(c: Campos, campo: CampoSolicitud, mensaje: string) {
  const caja = c.form.querySelector<HTMLElement>(`[data-campo="${campo}"]`)!;
  caja.classList.toggle('fm-invalida', !!mensaje);
  caja.querySelector('.fm-error')!.textContent = mensaje;
  if (mensaje) c.entradas[campo].setAttribute('aria-invalid', 'true');
  else c.entradas[campo].removeAttribute('aria-invalid');
}

/** Ficha del solicitante: roja con el nombre apenas se reconoce el centro; punteada mientras tanto. */
function pintarFicha(el: HTMLElement, centro: CentroDestino | undefined, escrito: string) {
  el.dataset.tipo = centro ? 'ok' : '';
  const circulo = crear('span', 'so-ficha-circulo');
  circulo.append(icono(TRAZOS.persona));
  if (!centro) {
    el.replaceChildren(circulo, crear('span', undefined, escrito ? 'Escribe o elige un código de la lista, por ejemplo AV10.' : 'El solicitante aparece al elegir el centro.'));
    return;
  }
  const textos = crear('span', 'so-ficha-texto');
  textos.append(crear('small', undefined, 'Solicitante'), crear('strong', undefined, centro.solicitante));
  const chips = crear('span', 'so-ficha-chips');
  chips.append(crear('span', 'so-ficha-chip', centro.codigo), crear('span', 'so-ficha-chip', centro.cd));
  el.replaceChildren(circulo, textos, chips);
}

/**
 * Muestra el solicitante del centro y la descripción del material.
 * Con "final" (al salir del campo o al guardar) también abre la descripción de un material nuevo;
 * mientras se escribe no la abre, para que no aparezca y desaparezca con cada número.
 */
function refrescar(c: Campos, final: boolean) {
  const texto = c.entradas.centro.value.trim();
  pintarFicha(c.infoCentro, buscarCentro(texto), texto);

  const material = codigoMaterial(c.entradas.material.value);
  const fija = material ? descripcionFija(c, material) : undefined;
  if (!material || fija) c.cajaDescripcion.hidden = true;
  else if (final) {
    if (c.cajaDescripcion.hidden && c.corregible && !c.entradas.descripcion.value) c.entradas.descripcion.value = aprendidas.get(material) ?? '';
    c.cajaDescripcion.hidden = false;
  }
  if (c.cajaDescripcion.hidden) marcar(c, 'descripcion', '');
  c.infoMaterial.dataset.tipo = fija ? 'ok' : '';
  if (fija) c.infoMaterial.replaceChildren(icono(TRAZOS.caja), crear('span', undefined, fija));
  else c.infoMaterial.textContent = !material ? 'La descripción se completa con el código.'
    : c.corregible ? 'Puedes corregir la descripción abajo.' : c.cajaDescripcion.hidden ? 'Código sin descripción guardada.' : 'Material nuevo: escribe su descripción.';
}

/** Valida con las reglas del servidor. Con "solo" marca únicamente ese campo. */
function revisar(c: Campos, solo?: CampoSolicitud): Solicitud | null {
  const { solicitud, errores } = revisarSolicitud(datosDe(c));
  for (const campo of CAMPOS) {
    if (solo && campo !== solo) continue;
    marcar(c, campo, campo === 'descripcion' && c.cajaDescripcion.hidden ? '' : errores[campo] ?? '');
  }
  return solicitud;
}

function enlazar(c: Campos, alCambiar?: () => void) {
  c.form.addEventListener('input', evento => {
    const campo = (evento.target as HTMLInputElement).name as CampoSolicitud;
    refrescar(c, false);
    // Un campo marcado con error se vuelve a revisar mientras se corrige.
    if (c.form.querySelector(`[data-campo="${campo}"].fm-invalida`)) revisar(c, campo);
    alCambiar?.();
  });
  c.form.addEventListener('change', evento => {
    const entrada = evento.target as HTMLInputElement;
    const campo = entrada.name as CampoSolicitud;
    // Si escribieron "av10" o "Turbaco", queda el código tal como sale en la tabla.
    if (campo === 'centro') { const centro = buscarCentro(entrada.value); if (centro) entrada.value = centro.codigo; }
    if (campo === 'material') entrada.value = codigoMaterial(entrada.value) || entrada.value.trim();
    refrescar(c, true);
    if (entrada.value.trim()) revisar(c, campo);
    alCambiar?.();
  });
}

function limpiarCampos(c: Campos, nombres: readonly CampoSolicitud[] = CAMPOS) {
  for (const campo of nombres) { c.entradas[campo].value = ''; marcar(c, campo, ''); }
  refrescar(c, false);
}

// ---------- Formulario principal: los artículos se juntan en una tabla y se guardan todos juntos ----------

const form = porId<HTMLFormElement>('soForm');
const campos = armarCampos(form, 'so', false);
const estadoForm = porId('soEstado');
const botonGuardar = porId<HTMLButtonElement>('soGuardar');
const botonQuitar = porId<HTMLButtonElement>('soQuitar');
const cuerpoArticulos = porId<HTMLTableSectionElement>('soArticulos');
const articulosVacio = porId('soArticulosVacio');
const guardado = porId<HTMLDialogElement>('fmGuardado');
let enfocarTrasGuardado: HTMLElement | null = null;
/** Artículos por guardar, en el orden en que se agregaron. */
let articulos: Solicitud[] = [];
const seleccionados = new Set<Solicitud>();
/** Artículo recién agregado (o sumado): su fila entra con un destello. */
let recienAgregado: Solicitud | null = null;

function pintarQuitar() {
  botonQuitar.hidden = !seleccionados.size;
  porId('soQuitarTexto').textContent = `Quitar seleccionados (${seleccionados.size})`;
}

function pintarArticulos() {
  const hoy = formatoFecha.format(new Date());
  cuerpoArticulos.replaceChildren(...articulos.map((a, i) => {
    const fila = crear('tr');
    const casilla = Object.assign(crear('input'), { type: 'checkbox', checked: seleccionados.has(a) });
    casilla.setAttribute('aria-label', `Seleccionar el artículo ${i + 1}: ${a.material} ${a.descripcion}`);
    casilla.addEventListener('change', () => {
      if (casilla.checked) seleccionados.add(a); else seleccionados.delete(a);
      fila.classList.toggle('so-elegida', casilla.checked);
      pintarQuitar();
    });
    const celdaCasilla = crear('td', 'so-sel');
    celdaCasilla.append(casilla);
    fila.classList.toggle('so-elegida', casilla.checked);
    if (a === recienAgregado) fila.classList.add('so-recien');
    fila.append(celdaCasilla, crear('td', 'so-nro', String(i + 1)), crear('td', undefined, hoy));
    const centro = crear('td', undefined, a.centro);
    centro.title = `${cdDe(a.centro)} · ${a.solicitante}`;
    fila.append(centro, crear('td', undefined, a.material), crear('td', 'so-desc', a.descripcion), crear('td', 'num so-cantidad', cifra(a.cantidad)));
    return fila;
  }));
  recienAgregado = null;
  articulosVacio.hidden = articulos.length > 0;
  porId('soGuardarTexto').textContent = articulos.length > 1 ? `Guardar solicitud (${articulos.length})` : 'Guardar solicitud';
  pintarQuitar();
}

/** Pasa lo escrito a la tabla de artículos. Si falta algo lo marca y devuelve false. */
function agregarArticulo(): boolean {
  refrescar(campos, true);
  const solicitud = revisar(campos);
  if (!solicitud) {
    mostrarEstado(estadoForm, 'Revisa los campos marcados.', 'error');
    form.querySelector<HTMLInputElement>('.fm-invalida input')?.focus();
    return false;
  }
  // El mismo material para el mismo centro no se repite: se suma a su línea.
  const igual = articulos.find(a => a.centro === solicitud.centro && a.material === solicitud.material);
  if (igual) {
    const total = leerCantidad(igual.cantidad + solicitud.cantidad);
    if (total === null) { mostrarEstado(estadoForm, 'La cantidad total de ese material es demasiado grande.', 'error'); return false; }
    igual.cantidad = total;
    recienAgregado = igual;
    mostrarEstado(estadoForm, `El material ${solicitud.material} ya estaba en la tabla para ${solicitud.centro}: se sumó la cantidad (ahora ${cifra(total)}).`, 'ok');
  } else {
    if (articulos.length >= MAX_LOTE) {
      mostrarEstado(estadoForm, `Puedes guardar hasta ${MAX_LOTE} artículos a la vez. Guarda estos y sigue con los demás.`, 'error');
      return false;
    }
    articulos.push(solicitud);
    recienAgregado = solicitud;
    mostrarEstado(estadoForm, '');
  }
  // El centro se queda: lo normal es pedir varios materiales para el mismo centro.
  limpiarCampos(campos, ['material', 'cantidad', 'descripcion']);
  pintarArticulos();
  pintarHistorial();
  campos.entradas.material.focus();
  return true;
}

function abrirGuardado(texto: string, enfocar: HTMLElement | null = null) {
  porId('fmGuardadoTexto').textContent = texto;
  // Desde la tabla no hace falta el botón para ir a la tabla.
  porId('fmGuardadoVer').hidden = vistaActual === 'solicitudes';
  enfocarTrasGuardado = enfocar;
  guardado.showModal();
}
porId('fmGuardadoCerrar').addEventListener('click', () => guardado.close());
porId('fmGuardadoVer').addEventListener('click', () => {
  enfocarTrasGuardado = null;
  guardado.close();
  mostrarVista('solicitudes', true);
});
guardado.addEventListener('click', evento => { if (evento.target === guardado) guardado.close(); });
guardado.addEventListener('close', () => { enfocarTrasGuardado?.focus(); enfocarTrasGuardado = null; });

porId('soLimpiar').addEventListener('click', () => {
  limpiarCampos(campos);
  articulos = [];
  seleccionados.clear();
  pintarArticulos();
  pintarHistorial();
  mostrarEstado(estadoForm, '');
  campos.entradas.centro.focus();
});

botonQuitar.addEventListener('click', () => {
  const cuantos = seleccionados.size;
  articulos = articulos.filter(a => !seleccionados.has(a));
  seleccionados.clear();
  pintarArticulos();
  mostrarEstado(estadoForm, cuantos === 1 ? 'Se quitó 1 artículo de la tabla.' : `Se quitaron ${cuantos} artículos de la tabla.`, 'ok');
  campos.entradas.material.focus();
});

// Enter en cualquier campo o el botón "Agregar a la tabla".
form.addEventListener('submit', evento => {
  evento.preventDefault();
  agregarArticulo();
});

botonGuardar.addEventListener('click', async () => {
  // Lo que esté escrito también entra; sin artículos, lo escrito es la solicitud.
  const escrito = campos.entradas.material.value.trim() || campos.entradas.cantidad.value.trim();
  if ((escrito || !articulos.length) && !agregarArticulo()) return;
  botonGuardar.disabled = true;
  mostrarEstado(estadoForm, articulos.length === 1 ? 'Guardando la solicitud…' : `Guardando ${articulos.length} artículos…`);
  try {
    const respuesta = await fetch('/api/solicitudes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ solicitudes: articulos }),
    });
    if (!respuesta.ok) {
      const mensaje = await errorDeApi(respuesta, 'No se pudo guardar la solicitud. Inténtalo de nuevo.');
      if (mensaje) mostrarEstado(estadoForm, mensaje, 'error');
      return;
    }
    const { solicitudes: nuevas } = await respuesta.json() as { solicitudes: Registro[] };
    if (registros) { registros = [...nuevas, ...registros]; pagina = 0; pintarTablero(); } else pintarHistorial();
    const centros = new Set(nuevas.map(r => r.respuestas.centro));
    const texto = nuevas.length === 1 ? `La solicitud de ${describir(nuevas[0])} quedó registrada.`
      : `Se registraron ${nuevas.length} artículos${centros.size === 1 ? ` para ${describir(nuevas[0])}` : ''}.`;
    articulos = [];
    seleccionados.clear();
    pintarArticulos();
    mostrarEstado(estadoForm, '');
    abrirGuardado(`${texto} El centro se mantiene por si vas a pedir otra cosa.`, campos.entradas.material);
  } catch {
    mostrarEstado(estadoForm, SIN_CONEXION, 'error');
  } finally {
    botonGuardar.disabled = false;
  }
});

// ---------- Historial del centro elegido (columna derecha de Nueva solicitud) ----------

const histCuerpo = porId('soHistCuerpo');
const histSub = porId('soHistSub');
const histPildora = porId('soHistCentro');
const avisoRepetido = porId('soRepetido');

/** La solicitud más reciente del mismo material para el mismo centro en los últimos 7 días (de hoy hasta hace 7 días). */
function pedidoRepetido(centro: string, material: string): Registro | undefined {
  return registros ? ordenados(registros).find(r => r.respuestas.centro === centro && r.respuestas.material === material && diasDesde(new Date(r.creado_en)) <= 7) : undefined;
}

/** Aviso amable: no bloquea el guardado, solo cuenta que ya se pidió. */
function pintarAviso(r: Registro | undefined) {
  avisoRepetido.hidden = !r;
  if (!r) { avisoRepetido.replaceChildren(); return; }
  const s = r.respuestas;
  const fecha = new Date(r.creado_en);
  const texto = crear('span');
  texto.append(
    crear('strong', undefined, 'Este material ya se pidió para este centro'),
    ` ${haceDias(fecha)} (${formatoFecha.format(fecha)}, ${typeof s.cantidad === 'number' ? cifra(s.cantidad) : '—'} unidades). Si es un pedido nuevo, puedes guardarlo igual.`,
  );
  avisoRepetido.replaceChildren(icono(TRAZOS.alerta), texto);
}

/** Los botones del historial llenan un campo como si se hubiera escrito y pasan al siguiente. */
function llenarCampo(campo: 'centro' | 'material', valor: string, siguiente: HTMLInputElement) {
  campos.entradas[campo].value = valor;
  campos.entradas[campo].dispatchEvent(new Event('change', { bubbles: true }));
  siguiente.focus();
}
const elegirCentro = (codigo: string) => llenarCampo('centro', codigo, campos.entradas.material);
const elegirMaterial = (codigo: string) => llenarCampo('material', codigo, campos.entradas.cantidad);

/** Sin centro: invita a elegir uno y ofrece los que pidieron hace poco. */
function invitacion(): HTMLElement {
  const caja = crear('div', 'so-hist-invita');
  const circulo = crear('span', 'so-hist-invita-circulo');
  circulo.append(icono(TRAZOS.pin));
  caja.append(circulo, crear('h3', undefined, 'Elige un centro'), crear('p', undefined, 'Aquí verás sus últimas 5 solicitudes y cuánto ha pedido este mes, para no repetir pedidos.'));
  const recientes = registros ? [...new Set(ordenados(registros).map(r => r.respuestas.centro).filter((c): c is string => !!c && !!cdDe(c)))].slice(0, 6) : [];
  if (recientes.length) {
    const lista = crear('div', 'so-hist-recientes');
    lista.setAttribute('role', 'group');
    lista.setAttribute('aria-label', 'Centros que pidieron hace poco');
    for (const codigo of recientes) {
      const boton = crear('button', 'so-hist-chip');
      boton.type = 'button';
      boton.append(crear('b', undefined, codigo), ` ${cdDe(codigo)}`);
      boton.addEventListener('click', () => elegirCentro(codigo));
      lista.append(boton);
    }
    caja.append(crear('small', 'so-hist-recientes-titulo', 'Pidieron hace poco'), lista);
  }
  return caja;
}

function miniDato(etiqueta: string, valor: string, detalle: string) {
  const li = crear('li', 'so-hist-dato');
  li.append(crear('small', undefined, etiqueta), crear('strong', undefined, valor), crear('span', undefined, detalle));
  return li;
}

/** Fila con lo que se lleva escrito, tal como quedará en el historial al guardar. */
function filaPorGuardar(): HTMLTableRowElement | null {
  const d = datosDe(campos);
  const material = codigoMaterial(d.material);
  const cantidad = leerCantidad(d.cantidad);
  if (!material && cantidad === null) return null;
  const descripcion = material ? (descripcionFija(campos, material) ?? d.descripcion.trim().toUpperCase()) : '';
  const fila = crear('tr', 'so-hist-nueva');
  const fecha = crear('td');
  fecha.append(crear('span', 'so-pildora-nueva', 'Por guardar'));
  fila.append(fecha, crear('td', undefined, material || '—'), crear('td', 'so-desc', descripcion || '—'), crear('td', 'num so-cantidad', cantidad === null ? '—' : cifra(cantidad)));
  return fila;
}

function pintarHistorial() {
  const centro = buscarCentro(campos.entradas.centro.value);
  const material = codigoMaterial(campos.entradas.material.value);
  const repetido = centro && material ? pedidoRepetido(centro.codigo, material) : undefined;
  pintarAviso(repetido);
  histPildora.hidden = !centro;
  if (!centro) {
    histSub.textContent = 'Elige un centro y aquí verás lo que ya pidió.';
    histCuerpo.replaceChildren(invitacion());
    return;
  }
  histPildora.textContent = `${centro.codigo} · ${centro.cd}`;
  histSub.textContent = `Pedidos de ${centro.solicitante}, solicitante del centro.`;
  if (!registros) {
    histCuerpo.replaceChildren(crear('p', 'so-hist-nota', fallaCarga ? 'No se pudo cargar el historial. Usa Actualizar en la pestaña Solicitudes.' : 'Consultando el historial…'));
    return;
  }
  const delCentro = ordenados(registros.filter(r => r.respuestas.centro === centro.codigo));
  const hoy = new Date();
  const delMes = delCentro.filter(r => claveMes(new Date(r.creado_en)) === claveMes(hoy));
  const nombreMes = formatoMes.format(hoy);
  const ultimo = delCentro[0];
  const datos = crear('ul', 'so-hist-datos');
  datos.append(
    miniDato(`Solicitudes en ${nombreMes}`, cifra(delMes.length), delCentro.length ? `${cifra(delCentro.length)} en total` : 'Ninguna todavía'),
    miniDato(`Unidades en ${nombreMes}`, cifra(sumar(delMes)), delMes.length ? 'pedidas este mes' : 'Nada este mes'),
    miniDato('Último pedido', ultimo ? mayuscula(haceDias(new Date(ultimo.creado_en))) : '—', ultimo ? formatoFecha.format(new Date(ultimo.creado_en)) : 'Sin pedidos'),
  );
  // Título de la lista y, a la derecha, el atajo al tablero filtrado por este centro.
  const filaTitulo = crear('div', 'so-hist-fila-titulo');
  filaTitulo.append(crear('h3', 'so-hist-subtitulo', 'Últimas 5 solicitudes'));
  if (delCentro.length) {
    const ver = crear('button', 'so-hist-ver');
    ver.type = 'button';
    ver.append(`Ver ${delCentro.length === 1 ? 'su solicitud' : `sus ${cifra(delCentro.length)} solicitudes`} en el tablero`, icono(TRAZOS.flecha));
    ver.addEventListener('click', () => verDelCentro(centro.codigo));
    filaTitulo.append(ver);
  }
  const partes: HTMLElement[] = [datos, filaTitulo];
  const nueva = filaPorGuardar();
  const filas = delCentro.slice(0, 5).map(r => {
    const s = r.respuestas;
    const fecha = new Date(r.creado_en);
    const fila = crear('tr', r === repetido ? 'so-hist-repetida' : undefined);
    const celdaFecha = crear('td', undefined, formatoCorta.format(fecha));
    celdaFecha.title = formatoFecha.format(fecha);
    const celdaDesc = crear('td', 'so-desc');
    if (r === repetido) celdaDesc.append(crear('span', 'so-pildora-repetida', 'Ya pedido'));
    celdaDesc.append(s.descripcion ?? '');
    fila.append(celdaFecha, crear('td', undefined, s.material ?? ''), celdaDesc, crear('td', 'num so-cantidad', typeof s.cantidad === 'number' ? cifra(s.cantidad) : ''));
    return fila;
  });
  if (nueva || filas.length) {
    const tabla = crear('table', 'fm-tb-tabla so-tabla so-hist-tabla');
    tabla.setAttribute('aria-label', `Últimas solicitudes de ${centro.codigo}`);
    const cabeza = tabla.createTHead().insertRow();
    for (const [texto, clase] of [['Fecha', ''], ['Material', ''], ['Descripción', ''], ['Cantidad', 'num']]) {
      const th = crear('th', clase || undefined, texto);
      th.scope = 'col';
      cabeza.append(th);
    }
    const cuerpoHist = tabla.createTBody();
    if (nueva) cuerpoHist.append(nueva);
    cuerpoHist.append(...filas);
    const caja = crear('div', 'fm-tb-tabla-caja so-tabla-caja');
    caja.append(tabla);
    partes.push(caja);
  }
  if (!filas.length) partes.push(crear('p', 'so-hist-nota', 'Este centro aún no tiene solicitudes: esta será la primera.'));
  if (delCentro.length) {
    // Materiales que más pide el centro: un toque los pone en el formulario.
    const frecuentes = new Map<string, { n: number; descripcion: string }>();
    for (const r of delCentro) {
      const codigo = r.respuestas.material;
      if (!codigo) continue;
      const f = frecuentes.get(codigo) ?? { n: 0, descripcion: r.respuestas.descripcion ?? '' };
      f.n += 1;
      frecuentes.set(codigo, f);
    }
    const titulo = crear('h3', 'so-hist-subtitulo', 'Lo que más pide · toca uno para usarlo');
    titulo.id = 'soHistFrecTitulo';
    const lista = crear('div', 'so-hist-frecuentes');
    lista.setAttribute('role', 'group');
    lista.setAttribute('aria-labelledby', 'soHistFrecTitulo');
    for (const [codigo, f] of [...frecuentes].sort(([a, x], [b, y]) => y.n - x.n || a.localeCompare(b)).slice(0, 4)) {
      const boton = crear('button', 'so-hist-material');
      boton.type = 'button';
      boton.setAttribute('aria-label', `Usar el material ${codigo}, ${f.descripcion}, pedido ${f.n === 1 ? 'una vez' : `${f.n} veces`}`);
      boton.append(crear('b', undefined, codigo), crear('span', undefined, f.descripcion), crear('em', undefined, f.n === 1 ? '1 vez' : `${f.n} veces`));
      boton.addEventListener('click', () => elegirMaterial(codigo));
      lista.append(boton);
    }
    partes.push(titulo, lista);
  }
  histCuerpo.replaceChildren(...partes);
}

// ---------- Tablero de solicitudes ----------

const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');
/** Las cifras de los indicadores cuentan desde su valor anterior hasta el nuevo (desde 0 al abrir la pestaña). */
function contar(el: HTMLElement, valor: number) {
  const desde = Number(el.dataset.valor ?? 0);
  el.dataset.valor = String(valor);
  cancelAnimationFrame(Number(el.dataset.cuadro ?? 0));
  if (sinMovimiento.matches || desde === valor) { el.textContent = cifra(valor); return; }
  const inicio = performance.now();
  const DURACION = 900;
  const paso = (ahora: number) => {
    const t = Math.max(0, Math.min(1, (ahora - inicio) / DURACION)); // el primer cuadro puede llegar antes de "inicio"
    el.textContent = cifra(Math.round(desde + (valor - desde) * (1 - (1 - t) ** 3)));
    if (t < 1) el.dataset.cuadro = String(requestAnimationFrame(paso));
  };
  el.dataset.cuadro = String(requestAnimationFrame(paso));
}
/** Al escribir en el buscador no se repiten las animaciones de filas y barras en cada letra. */
let sinAnimar = false;

const cuerpo = porId<HTMLTableElement>('soTabla').tBodies[0];
const cajaTabla = porId('soTablaCaja');
const estadoTabla = porId('soTablaEstado');
const buscar = porId<HTMLInputElement>('soBuscar');
/** Fecha del tablero (AAAA-MM-DD). Vacía: todas las fechas. Al abrir la página, hoy. */
const filtroFecha = porId<HTMLInputElement>('soFecha');
const filtroCentro = porId<HTMLSelectElement>('soFiltroCentro');
const vacio = porId('soVacio');
const vacioNueva = porId('soVacioNueva');
const mostrando = porId('soMostrando');
const paginas = porId('soPaginas');
const numerosPagina = porId('soPaginaNumeros');
const mostrandoPie = porId('soMostrandoPie');
const filtrosMenu = porId<HTMLDetailsElement>('soFiltros');
const filtrosCuenta = porId('soFiltrosCuenta');
const anterior = porId<HTMLButtonElement>('soAnterior');
const siguiente = porId<HTMLButtonElement>('soSiguiente');
const grafico = porId('soGrafico');
const graficoSub = porId('soGraficoSub');
const top = porId('soTop');
const kpi = {
  solEt: porId('soKpiSolEt'), sol: porId('soKpiSol'), solUni: porId('soKpiSolUni'),
  solDelta: porId('soKpiSolDelta'), solDeltaValor: porId('soKpiSolDeltaValor'), solDeltaTexto: porId('soKpiSolDeltaTexto'),
  uniEt: porId('soKpiUniEt'), uni: porId('soKpiUni'), uniDer: porId('soKpiUniDer'), uniCentro: porId('soKpiUniCentro'), uniValor: porId('soKpiUniValor'),
  cen: porId('soKpiCen'), cenDe: porId('soKpiCenDe'), cenArco: porId<SVGCircleElement>('soKpiCenArco'), cenNota: porId('soKpiCenNota'),
  ultFecha: porId('soKpiUltFecha'), ultHace: porId('soKpiUltHace'), ultQuien: porId('soKpiUltQuien'), ultQue: porId('soKpiUltQue'),
};

/** Recorre del más antiguo al más reciente: la última descripción escrita para un material es la que vale. */
function aprender(lista: readonly Registro[]) {
  aprendidas = new Map();
  for (let i = lista.length - 1; i >= 0; i--) {
    const { material, descripcion } = lista[i].respuestas;
    if (material && descripcion && !MATERIALES[material]) aprendidas.set(material, descripcion);
  }
  const materiales = new Map([...Object.entries(MATERIALES), ...aprendidas]);
  porId('soMateriales').replaceChildren(...[...materiales].sort(([a], [b]) => a.localeCompare(b)).map(([codigo, texto]) => new Option(texto, codigo)));
}

/** Texto y botones del filtro de fecha: "Hoy", ‹ día anterior y › día siguiente (no pasa de hoy). */
function pintarFecha() {
  const hoy = claveDia(new Date());
  const dia = filtroFecha.value;
  filtroFecha.max = hoy;
  porId('soFechaDia').textContent = dia ? nombreDia(dia) : 'Todas las fechas';
  porId('soFecha').closest('.so-fecha-pildora')?.classList.toggle('todas', !dia);
  porId<HTMLButtonElement>('soDiaSiguiente').disabled = !!dia && dia >= hoy;
  porId('soHoy').hidden = dia === hoy;
}

/** Solicitudes que pasan la búsqueda, el centro y la fecha (por defecto, la fecha elegida en el tablero). */
function filtrados(lista: readonly Registro[], dia = filtroFecha.value): Registro[] {
  const texto = normal(buscar.value.trim());
  return ordenados(lista.filter(r => {
    const s = r.respuestas;
    if (dia && claveDia(new Date(r.creado_en)) !== dia) return false;
    if (filtroCentro.value && s.centro !== filtroCentro.value) return false;
    if (!texto) return true;
    return normal([s.solicitante, s.centro, cdDe(s.centro), s.material, s.descripcion, r.usuario_nombre, formatoFecha.format(new Date(r.creado_en))].join(' ')).includes(texto);
  }));
}

/** Indicadores del periodo filtrado: solicitudes, unidades, centros que pidieron y último pedido. */
function pintarIndicadores(lista: readonly Registro[]) {
  const dia = filtroFecha.value;
  const periodo = dia ? delDia(dia) : 'en total';
  kpi.solEt.textContent = `Solicitudes ${periodo}`;
  contar(kpi.sol, lista.length);
  kpi.solUni.textContent = lista.length === 1 ? 'solicitud' : 'solicitudes';
  // Comparación con el día anterior, con los mismos filtros de centro y búsqueda.
  const previo = dia ? sumarDias(dia, -1) : '';
  const antes = previo && registros ? filtrados(registros, previo).length : 0;
  // Sin solicitudes en el día elegido no se compara: a primera hora de hoy daría un "−100 %" engañoso.
  const comparar = antes > 0 && lista.length > 0;
  kpi.solDelta.hidden = !comparar;
  if (comparar) {
    const cambio = Math.round(((lista.length - antes) / antes) * 100);
    kpi.solDeltaValor.textContent = cambio > 0 ? `+${cambio}%` : cambio < 0 ? `−${Math.abs(cambio)}%` : 'Igual';
    kpi.solDeltaTexto.textContent = nombreDia(dia) === 'Hoy' ? 'que ayer' : 'que el día anterior';
    kpi.solDelta.dataset.tendencia = cambio > 0 ? 'sube' : cambio < 0 ? 'baja' : 'igual';
    kpi.solDelta.title = `${formatoFecha.format(fechaDeDia(previo))}: ${plural(antes, 'solicitud', 'solicitudes')}`;
  }

  kpi.uniEt.textContent = `Unidades ${periodo}`;
  contar(kpi.uni, sumar(lista));
  const mayor = lista.reduce<Registro | undefined>((m, r) => (!m || cantidadDe(r) > cantidadDe(m) ? r : m), undefined);
  kpi.uniDer.hidden = !mayor;
  if (mayor) {
    kpi.uniCentro.textContent = `${mayor.respuestas.centro ?? '—'} - ${cdDe(mayor.respuestas.centro)}`;
    kpi.uniValor.textContent = cifra(cantidadDe(mayor));
  }

  const conPedido = new Set(lista.map(r => r.respuestas.centro));
  const total = CENTROS_DESTINO.length;
  const pidieron = CENTROS_DESTINO.filter(c => conPedido.has(c.codigo));
  contar(kpi.cen, pidieron.length);
  kpi.cenDe.textContent = `de ${total}`;
  kpi.cenArco.setAttribute('stroke-dasharray', `${(pidieron.length / total) * 100} 100`);
  const faltan = CENTROS_DESTINO.filter(c => !conPedido.has(c.codigo)).map(c => c.codigo);
  kpi.cenNota.textContent = filtroCentro.value ? `Filtrado por ${filtroCentro.value}`
    : !faltan.length ? 'Todos los centros pidieron.'
    : `Sin pedidos: ${faltan.slice(0, 3).join(', ')}${faltan.length > 3 ? ` y ${faltan.length - 3} más` : ''}`;
  kpi.cenNota.title = faltan.length && !filtroCentro.value ? `Sin pedidos: ${faltan.join(', ')}` : '';

  const ultimo = lista[0];
  kpi.ultHace.hidden = !ultimo;
  if (!ultimo) {
    kpi.ultFecha.textContent = '—';
    kpi.ultQuien.textContent = dia ? 'Sin solicitudes este día' : 'Sin solicitudes';
    kpi.ultQue.textContent = '';
    return;
  }
  const s = ultimo.respuestas;
  const fecha = new Date(ultimo.creado_en);
  kpi.ultFecha.textContent = formatoFecha.format(fecha);
  kpi.ultHace.textContent = haceDias(fecha);
  kpi.ultQuien.textContent = `${s.centro ?? '—'} - ${s.solicitante ?? ''}`;
  kpi.ultQue.textContent = `${s.material ?? ''} - ${typeof s.cantidad === 'number' ? cifra(s.cantidad) : '—'} und`;
}

// Barras horizontales "Solicitudes por centro": unidades pedidas por cada centro, con eje de valores abajo
// (SVG propio, se redibuja al cambiar el ancho).
interface Barra { codigo: string; n: number; unidades: number }
let barras: Barra[] = [];
let anchoDibujado = 0;

function nodo<K extends keyof SVGElementTagNameMap>(etiqueta: K, atributos: Record<string, string | number>, texto?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) el.setAttribute(nombre, String(valor));
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function pintarGrafico(lista: readonly Registro[]) {
  const por = new Map<string, Barra>();
  for (const r of lista) {
    const codigo = r.respuestas.centro ?? '—';
    const b = por.get(codigo) ?? { codigo, n: 0, unidades: 0 };
    b.n += 1;
    b.unidades += cantidadDe(r);
    por.set(codigo, b);
  }
  barras = [...por.values()].sort((a, b) => b.unidades - a.unidades || b.n - a.n || a.codigo.localeCompare(b.codigo));
  graficoSub.textContent = `${tituloDia(filtroFecha.value)} • ${plural(lista.length, 'solicitud', 'solicitudes')} en ${plural(barras.length, 'centro', 'centros')}`;
  dibujarGrafico();
}

/** Marcas "redondas" del eje (0, 250k, 500k…): unas 5, de a pasos enteros. */
function marcasEje(max: number): number[] {
  const bruto = Math.max(max, 1) / 5;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = Math.max(1, [1, 2, 2.5, 5, 10].map(f => f * potencia).find(p => p >= bruto) ?? 10 * potencia);
  const marcas = [0];
  while (marcas[marcas.length - 1] < max) marcas.push(marcas[marcas.length - 1] + paso);
  return marcas.length > 1 ? marcas : [0, paso];
}
/** Cifra corta para el eje: 250k, 1M, 1,25M. */
const cifraCorta = (n: number) => n >= 1e6 ? `${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 2 })}M`
  : n >= 1e3 ? `${(n / 1e3).toLocaleString('es-CO', { maximumFractionDigits: 1 })}k` : cifra(n);

function dibujarGrafico() {
  const ancho = Math.floor(grafico.clientWidth);
  anchoDibujado = ancho;
  if (!barras.length) {
    grafico.replaceChildren(crear('p', 'so-grafico-vacio', !registros?.length ? 'Aún no hay solicitudes para graficar.' : sinDelDia() ? `No hay solicitudes ${enElDia(filtroFecha.value)}. Usa ‹ para ver el día anterior.` : 'Ninguna solicitud coincide con los filtros.'));
    return;
  }
  if (!ancho) return; // Pestaña oculta: se dibuja al mostrarse (ResizeObserver).
  // Con pocos centros las filas se separan un poco más para llenar la tarjeta al lado del top 5.
  const FILA = Math.max(30, Math.min(40, Math.floor(300 / barras.length))), GROSOR = 12, RADIO = 3, VALORES = 104;
  const etiqueta = Math.min(150, Math.round(ancho * 0.24));
  const izquierda = etiqueta + 12;
  const largo = Math.max(60, ancho - izquierda - VALORES - 18);
  const altoBarras = barras.length * FILA;
  const alto = altoBarras + 28;
  const marcas = marcasEje(Math.max(...barras.map(b => b.unidades)));
  const tope = marcas[marcas.length - 1];
  const xDe = (v: number) => izquierda + (v / tope) * largo;
  const svg = nodo('svg', { width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}`, role: 'img', class: 'so-barras-svg' });
  svg.setAttribute('aria-label', `Unidades pedidas por centro: ${barras.map(b => `${b.codigo} ${cifra(b.unidades)}`).join(', ')}`);
  // Guías verticales y valores del eje.
  for (const m of marcas) {
    const x = xDe(m);
    svg.append(nodo('line', { x1: x, x2: x, y1: 0, y2: altoBarras, class: m ? 'so-barras-guia' : 'so-barras-eje' }));
    svg.append(nodo('text', { x, y: altoBarras + 19, 'text-anchor': 'middle', class: 'so-barras-marca' }, cifraCorta(m)));
  }
  barras.forEach((b, i) => {
    const centroY = i * FILA + FILA / 2;
    const w = b.unidades > 0 ? Math.max(RADIO * 2, (b.unidades / tope) * largo) : 0;
    const y = centroY - GROSOR / 2;
    const g = nodo('g', { class: 'so-barra', style: `--i:${i}` });
    g.append(nodo('title', {}, `${b.codigo} · ${cdDe(b.codigo)}: ${cifra(b.unidades)} unidades en ${plural(b.n, 'solicitud', 'solicitudes')}`));
    g.append(nodo('rect', { x: 0, y: centroY - FILA / 2, width: ancho, height: FILA, class: 'so-barra-zona' }));
    const nombre = nodo('text', { x: etiqueta, y: centroY, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'so-barra-nombre' });
    nombre.append(nodo('tspan', { class: 'so-barra-codigo' }, b.codigo), nodo('tspan', { class: 'so-barra-cd', dx: 5 }, cdDe(b.codigo)));
    g.append(nombre);
    // Barra cuadrada en la base y redondeada en la punta.
    if (w) g.append(nodo('path', { class: 'so-barra-trazo', d: `M${izquierda} ${y}h${w - RADIO}a${RADIO} ${RADIO} 0 0 1 ${RADIO} ${RADIO}v${GROSOR - 2 * RADIO}a${RADIO} ${RADIO} 0 0 1 -${RADIO} ${RADIO}h-${w - RADIO}z` }));
    g.append(nodo('text', { x: izquierda + largo + 18, y: centroY, 'dominant-baseline': 'central', class: 'so-barra-valor' }, `${cifra(b.unidades)} und`));
    svg.append(g);
  });
  grafico.replaceChildren(svg);
}
// Se redibuja en el siguiente cuadro, no dentro del aviso de tamaño, para no encadenar cambios de alto.
let cuadroGrafico = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(cuadroGrafico);
  cuadroGrafico = requestAnimationFrame(() => { if (Math.floor(grafico.clientWidth) !== anchoDibujado) dibujarGrafico(); });
}).observe(grafico);

/** Top 5 de materiales por número de solicitudes (las unidades no se comparan: cada material se cuenta distinto). */
function pintarTop(lista: readonly Registro[]) {
  const por = new Map<string, { n: number; unidades: number; descripcion: string }>();
  for (const r of lista) {
    const codigo = r.respuestas.material;
    if (!codigo) continue;
    const m = por.get(codigo) ?? { n: 0, unidades: 0, descripcion: r.respuestas.descripcion ?? '' };
    m.n += 1;
    m.unidades += cantidadDe(r);
    por.set(codigo, m);
  }
  const primeros = [...por].sort(([a, x], [b, y]) => y.n - x.n || y.unidades - x.unidades || a.localeCompare(b)).slice(0, 5);
  if (!primeros.length) {
    top.replaceChildren(crear('li', 'so-top-vacio', !registros?.length ? 'Aún no hay materiales pedidos.' : sinDelDia() ? 'Ningún material pedido este día.' : 'Ningún material coincide con los filtros.'));
    return;
  }
  const max = primeros[0][1].n;
  top.replaceChildren(...primeros.map(([codigo, m], i) => {
    const li = crear('li', 'so-top-item');
    li.style.setProperty('--i', String(i));
    const texto = crear('span', 'so-top-texto');
    const barra = crear('i', 'so-top-barra');
    barra.style.setProperty('--p', String(m.n / max));
    texto.append(crear('b', undefined, codigo), crear('small', undefined, m.descripcion), barra);
    const cifras = crear('span', 'so-top-cifras');
    cifras.append(crear('b', undefined, plural(m.n, 'solicitud', 'solicitudes')), crear('small', undefined, `${cifra(m.unidades)} und`));
    li.append(crear('span', 'so-top-pos', String(i + 1)), texto, cifras);
    return li;
  }));
}

function botonAccion(clase: 'ver' | 'editar' | 'eliminar', texto: string, r: Registro, hacer: () => void) {
  const boton = crear('button', `so-accion ${clase}`);
  boton.type = 'button';
  boton.title = texto;
  boton.setAttribute('aria-label', `${texto} la solicitud de ${describir(r)}, material ${r.respuestas.material ?? ''}`);
  boton.append(icono(TRAZOS[clase]));
  boton.addEventListener('click', hacer);
  return boton;
}

function filaDe(r: Registro, indice = 0): HTMLTableRowElement {
  const s = r.respuestas;
  const fecha = new Date(r.creado_en);
  const fila = crear('tr');
  fila.style.setProperty('--f', String(indice));
  const celda = (clase: string, ...hijos: (Node | string)[]) => { const td = crear('td', clase); td.append(...hijos); fila.append(td); return td; };
  const pildora = (clase: string, ...hijos: (Node | string)[]) => { const p = crear('span', `so-pildora ${clase}`); p.append(...hijos); return p; };
  const lleno = (trazos: string) => icono(trazos, 'fm-ico so-ico-lleno');

  const avatar = crear('span', 'so-avatar');
  avatar.append(lleno(TRAZOS.personaLlena));
  const quien = crear('span', 'so-quien');
  quien.append(avatar, crear('b', undefined, s.solicitante ?? ''));
  celda('so-c-solicitante', quien);
  celda('so-c-mes', pildora('so-p-mes', formatoMes.format(fecha)));
  const cuando = crear('span', 'so-fecha-celda');
  cuando.append(icono(TRAZOS.calendario), formatoFecha.format(fecha));
  celda('so-c-fecha', cuando).title = `Registrada por ${r.usuario_nombre} a las ${formatoHora.format(fecha)}`;
  celda('so-c-centro', pildora('so-p-centro', lleno(TRAZOS.pinLleno), s.centro ?? '—')).title = cdDe(s.centro);
  celda('so-c-material', pildora('so-p-material', lleno(TRAZOS.cuboLleno), s.material ?? '—'));
  celda('so-c-desc', crear('span', 'so-desc-texto', s.descripcion ?? ''));
  celda('so-c-cantidad so-col-cantidad', pildora('so-p-cantidad', typeof s.cantidad === 'number' ? cifra(s.cantidad) : '—'));
  const acciones = crear('td', 'so-acciones');
  acciones.append(botonAccion('ver', 'Ver', r, () => abrirVer(r)), botonAccion('editar', 'Editar', r, () => abrirEdicion(r)), botonAccion('eliminar', 'Eliminar', r, () => abrirEliminacion(r)));
  fila.append(acciones);
  return fila;
}

function pintarTablero() {
  if (!registros) return;
  porId('soListado').classList.toggle('so-quieto', sinAnimar);
  sinAnimar = false;
  aprender(registros);
  pintarFecha();
  const lista = filtrados(registros);
  pintarIndicadores(lista);
  pintarGrafico(lista);
  pintarTop(lista);

  const total = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  pagina = Math.min(pagina, total - 1);
  const desde = pagina * POR_PAGINA;
  const visibles = lista.slice(desde, desde + POR_PAGINA);
  cuerpo.replaceChildren(...visibles.map(filaDe));
  cajaTabla.hidden = !lista.length;
  vacio.hidden = !!lista.length;
  porId('soVacioTexto').textContent = !registros.length ? 'Aún no hay solicitudes. Registra la primera en la pestaña Nueva solicitud.'
    : sinDelDia() ? `No hay solicitudes registradas ${enElDia(filtroFecha.value)}. Usa la flecha ‹ del gráfico para ver el día anterior.`
    : 'Ninguna solicitud coincide con la búsqueda o los filtros.';
  vacioNueva.hidden = !!registros.length;
  const rango = lista.length ? `Mostrando ${desde + 1}–${desde + visibles.length} de ${cifra(lista.length)}` : 'Sin filas para mostrar';
  mostrando.textContent = truncado ? `${rango} · se muestran las ${cifra(registros.length)} más recientes` : rango;
  mostrandoPie.textContent = lista.length ? `${rango} ${lista.length === 1 ? 'registro' : 'registros'}` : '';
  paginas.hidden = !lista.length;
  pintarNumerosPagina(total);
  anterior.disabled = pagina === 0;
  siguiente.disabled = pagina >= total - 1;
  // El botón Filtros muestra cuántos filtros hay puestos (la fecha va en el gráfico).
  const activos = filtroCentro.value ? 1 : 0;
  filtrosCuenta.hidden = !activos;
  filtrosCuenta.textContent = String(activos);
  // Lo aprendido puede completar la descripción que se está escribiendo; el historial usa los datos nuevos.
  refrescar(campos, false);
  pintarHistorial();
}

/** Botones de página: 1 … 4 5 6 … 10, con la actual en rojo. */
function pintarNumerosPagina(total: number) {
  const orden = [...new Set([0, total - 1, pagina - 1, pagina, pagina + 1])].filter(p => p >= 0 && p < total).sort((a, b) => a - b);
  const nodos: HTMLElement[] = [];
  orden.forEach((p, i) => {
    if (i && p - orden[i - 1] > 1) {
      const salto = crear('span', 'so-pag-salto', '…');
      salto.setAttribute('aria-hidden', 'true');
      nodos.push(salto);
    }
    const boton = crear('button', 'so-pag', String(p + 1));
    boton.type = 'button';
    boton.setAttribute('aria-label', `Página ${p + 1}`);
    if (p === pagina) boton.setAttribute('aria-current', 'page');
    boton.addEventListener('click', () => { pagina = p; pintarTablero(); });
    nodos.push(boton);
  });
  numerosPagina.replaceChildren(...nodos);
}

/** El día elegido no tiene ninguna solicitud (sin contar búsqueda ni centro). */
const sinDelDia = () => !!filtroFecha.value && !!registros?.length && !registros.some(r => claveDia(new Date(r.creado_en)) === filtroFecha.value);

const alFiltrar = () => { pagina = 0; pintarTablero(); };
buscar.addEventListener('input', () => { sinAnimar = true; alFiltrar(); });
filtroFecha.addEventListener('change', alFiltrar);
const irADia = (dia: string) => { filtroFecha.value = dia; alFiltrar(); };
porId('soDiaAnterior').addEventListener('click', () => irADia(sumarDias(filtroFecha.value || claveDia(new Date()), -1)));
porId('soDiaSiguiente').addEventListener('click', () => {
  const hoy = claveDia(new Date());
  const siguiente = sumarDias(filtroFecha.value || hoy, 1);
  irADia(siguiente > hoy ? hoy : siguiente);
});
porId('soHoy').addEventListener('click', () => irADia(claveDia(new Date())));
porId('soTodasFechas').addEventListener('click', () => { filtrosMenu.open = false; irADia(''); });
filtroCentro.addEventListener('change', alFiltrar);
anterior.addEventListener('click', () => { pagina -= 1; pintarTablero(); });
siguiente.addEventListener('click', () => { pagina += 1; pintarTablero(); });
porId('soActualizar').addEventListener('click', () => { filtrosMenu.open = false; void cargar(); });
porId('soQuitarFiltros').addEventListener('click', () => {
  filtroCentro.value = '';
  buscar.value = '';
  filtrosMenu.open = false;
  alFiltrar();
});
// El menú de filtros se cierra al tocar fuera de él o con Escape.
document.addEventListener('click', evento => { if (filtrosMenu.open && !filtrosMenu.contains(evento.target as Node)) filtrosMenu.open = false; });
filtrosMenu.addEventListener('keydown', evento => {
  if (evento.key !== 'Escape' || !filtrosMenu.open) return;
  filtrosMenu.open = false;
  filtrosMenu.querySelector<HTMLElement>('summary')?.focus();
});
vacioNueva.addEventListener('click', () => mostrarVista('nueva', true));

/** Desde el historial: abre el tablero con todas las solicitudes de ese centro. */
function verDelCentro(codigo: string) {
  buscar.value = '';
  filtroFecha.value = '';
  filtroCentro.value = codigo;
  pagina = 0;
  pintarTablero();
  mostrarVista('solicitudes', true);
}

// ---------- Editar ----------

const dialogoEditar = porId<HTMLDialogElement>('soEditar');
const formEditar = porId<HTMLFormElement>('soEditarForm');
const edicion = armarCampos(formEditar, 'soe', true);
const estadoEditar = porId('soEditarEstado');
const botonGuardarEdicion = porId<HTMLButtonElement>('soEditarGuardar');
let enEdicion: Registro | null = null;

function abrirEdicion(r: Registro) {
  enEdicion = r;
  const s = r.respuestas;
  edicion.entradas.centro.value = s.centro ?? '';
  edicion.entradas.material.value = s.material ?? '';
  edicion.entradas.cantidad.value = typeof s.cantidad === 'number' ? String(s.cantidad) : '';
  edicion.entradas.descripcion.value = s.descripcion ?? '';
  edicion.cajaDescripcion.hidden = true;
  CAMPOS.forEach(campo => marcar(edicion, campo, ''));
  refrescar(edicion, true);
  porId('soEditarDetalle').textContent = `Solicitud del ${formatoFecha.format(new Date(r.creado_en))}, registrada por ${r.usuario_nombre}. La fecha no cambia.`;
  mostrarEstado(estadoEditar, '');
  dialogoEditar.showModal();
  edicion.entradas.centro.focus();
}

porId('soEditarCancelar').addEventListener('click', () => dialogoEditar.close());
porId('soEditarCerrar').addEventListener('click', () => dialogoEditar.close());
dialogoEditar.addEventListener('close', () => { enEdicion = null; });

formEditar.addEventListener('submit', async evento => {
  evento.preventDefault();
  const registro = enEdicion;
  if (!registro) return;
  refrescar(edicion, true);
  const solicitud = revisar(edicion);
  if (!solicitud) {
    mostrarEstado(estadoEditar, 'Revisa los campos marcados.', 'error');
    formEditar.querySelector<HTMLInputElement>('.fm-invalida input')?.focus();
    return;
  }
  botonGuardarEdicion.disabled = true;
  mostrarEstado(estadoEditar, 'Guardando cambios…');
  try {
    const respuesta = await fetch(`/api/solicitudes/${encodeURIComponent(registro.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ solicitud }),
    });
    if (!respuesta.ok) {
      const mensaje = await errorDeApi(respuesta, 'No se pudo guardar el cambio. Inténtalo de nuevo.');
      if (mensaje) mostrarEstado(estadoEditar, mensaje, 'error');
      return;
    }
    const { solicitud: actualizada } = await respuesta.json() as { solicitud: Registro };
    if (registros) registros = registros.map(r => r.id === actualizada.id ? actualizada : r);
    pintarTablero();
    dialogoEditar.close();
    abrirGuardado(`Los cambios de la solicitud de ${describir(actualizada)} quedaron guardados.`);
  } catch {
    mostrarEstado(estadoEditar, SIN_CONEXION, 'error');
  } finally {
    botonGuardarEdicion.disabled = false;
  }
});

// ---------- Ver (detalle de una solicitud, solo lectura) ----------

const dialogoVer = porId<HTMLDialogElement>('soVer');
let enVista: Registro | null = null;

function abrirVer(r: Registro) {
  enVista = r;
  const s = r.respuestas;
  const fecha = new Date(r.creado_en);
  porId('soVerSub').textContent = `Registrada el ${formatoFecha.format(fecha)} a las ${formatoHora.format(fecha)} por ${r.usuario_nombre}.`;
  const datos: [string, string, boolean?][] = [
    ['Solicitante', s.solicitante ?? '—'],
    ['Centro destino', `${s.centro ?? '—'} - ${cdDe(s.centro)}`],
    ['Mes', mayuscula(formatoMes.format(fecha))],
    ['Fecha de solicitud', formatoFecha.format(fecha)],
    ['Material', s.material ?? '—'],
    ['Cantidad', typeof s.cantidad === 'number' ? `${cifra(s.cantidad)} und` : '—'],
    ['Descripción', s.descripcion ?? '—', true],
  ];
  porId('soVerDatos').replaceChildren(...datos.map(([titulo, valor, ancho], i) => {
    const dato = crear('div', ancho ? 'so-ver-dato ancho' : 'so-ver-dato');
    dato.style.setProperty('--i', String(i));
    dato.append(crear('dt', undefined, titulo), crear('dd', undefined, valor));
    return dato;
  }));
  dialogoVer.showModal();
}
porId('soVerCerrar').addEventListener('click', () => dialogoVer.close());
porId('soVerListo').addEventListener('click', () => dialogoVer.close());
porId('soVerEditar').addEventListener('click', () => {
  const r = enVista;
  dialogoVer.close();
  if (r) abrirEdicion(r);
});
dialogoVer.addEventListener('click', evento => { if (evento.target === dialogoVer) dialogoVer.close(); });
dialogoVer.addEventListener('close', () => { enVista = null; });

// ---------- Centros que pidieron (ventana con los 15 centros) ----------

const dialogoCentros = porId<HTMLDialogElement>('soCentrosDialogo');

/** Encuadres de la foto de bodega: cada ficha muestra una parte distinta. */
const ENCUADRES = ['64%', '74%', '84%', '94%', '100%', '70%', '90%'];

/**
 * Ficha de un centro sobre la foto de la bodega: oscura con borde verde si pidió (con sus cifras y "Ver en la tabla");
 * clara con "Sin pedido" si no.
 */
function fichaCentro(c: CentroDestino, lista: readonly Registro[], orden: number): HTMLLIElement {
  const pidio = lista.length > 0;
  const ficha = crear('li', `so-centro ${pidio ? 'pidio' : 'sin'}`);
  ficha.style.setProperty('--i', String(orden));
  ficha.style.setProperty('--foto-x', ENCUADRES[orden % ENCUADRES.length]);
  const marca = crear('span', 'so-centro-marca');
  marca.append(icono(pidio ? TRAZOS.chulo : TRAZOS.menos));
  const linea = (trazos: string, texto: string, clase = '') => {
    const el = crear('span', `so-centro-linea${clase}`);
    el.append(icono(trazos, 'fm-ico so-ico-lleno'), texto);
    return el;
  };
  const estado = crear('span', 'so-centro-estado');
  // Código y ciudad en la misma línea, para que la ficha sea baja y quepan los 15 centros.
  const cabeza = crear('span', 'so-centro-cabeza');
  cabeza.append(crear('b', 'so-centro-codigo', c.codigo), linea(TRAZOS.pinLleno, c.cd));
  ficha.append(marca, cabeza, linea(TRAZOS.personaLlena, c.solicitante));
  if (!pidio) {
    estado.append(icono(TRAZOS.equis), 'Sin pedido');
    ficha.append(estado);
    return ficha;
  }
  estado.append(icono(TRAZOS.chulo), `${plural(lista.length, 'solicitud', 'solicitudes')} · ${cifra(sumar(lista))} und`);
  const ultimo = crear('span', 'so-centro-linea so-centro-ultimo');
  ultimo.append(icono(TRAZOS.calendario), `Último pedido: ${formatoFecha.format(new Date(lista[0].creado_en))}`);
  const ver = crear('button', 'so-centro-ver');
  ver.type = 'button';
  ver.setAttribute('aria-label', `Ver las solicitudes de ${c.codigo} ${c.cd} en la tabla`);
  ver.append(icono(TRAZOS.ver), 'Ver en la tabla', icono(TRAZOS.derecha));
  ver.addEventListener('click', () => {
    dialogoCentros.close();
    buscar.value = '';
    filtroCentro.value = c.codigo;
    alFiltrar();
    porId('soDetalleTitulo').scrollIntoView({ block: 'start' });
  });
  ficha.append(estado, ultimo, ver);
  return ficha;
}

function abrirCentros() {
  if (!registros) return;
  // El día elegido, sin la búsqueda ni el filtro de centro: así se ve quién pidió y quién falta.
  const dia = filtroFecha.value;
  const delPeriodo = ordenados(registros.filter(r => !dia || claveDia(new Date(r.creado_en)) === dia));
  const porCentro = new Map<string, Registro[]>();
  for (const r of delPeriodo) {
    const codigo = r.respuestas.centro;
    if (codigo) porCentro.set(codigo, [...(porCentro.get(codigo) ?? []), r]);
  }
  const si = CENTROS_DESTINO.filter(c => porCentro.has(c.codigo));
  const no = CENTROS_DESTINO.filter(c => !porCentro.has(c.codigo));
  porId('soCentrosSub').textContent = `${tituloDia(dia)} · ${si.length} de ${CENTROS_DESTINO.length} centros hicieron solicitudes`;
  porId('soCentrosSiTitulo').textContent = `Pidieron (${si.length})`;
  porId('soCentrosNoTitulo').textContent = `Sin pedido (${no.length})`;
  porId('soCentrosSi').replaceChildren(...(si.length ? si.map((c, i) => fichaCentro(c, porCentro.get(c.codigo) ?? [], i)) : [crear('li', 'so-centros-vacio', dia ? 'Ningún centro ha pedido este día.' : 'Ningún centro ha pedido todavía.')]));
  porId('soCentrosNo').replaceChildren(...(no.length ? no.map((c, i) => fichaCentro(c, [], si.length + i)) : [crear('li', 'so-centros-vacio', dia ? 'Todos los centros pidieron este día.' : 'Todos los centros han pedido.')]));
  dialogoCentros.showModal();
}
porId('soVerCentros').addEventListener('click', abrirCentros);
porId('soCentrosCerrar').addEventListener('click', () => dialogoCentros.close());
porId('soCentrosListo').addEventListener('click', () => dialogoCentros.close());
dialogoCentros.addEventListener('click', evento => { if (evento.target === dialogoCentros) dialogoCentros.close(); });

// ---------- Eliminar (misma ventana y animación del bote de basura de Control de inventarios) ----------

const dialogoEliminar = porId<HTMLDialogElement>('fmEliminar');
const estadoEliminar = porId('fmEliminarEstado');
const botonConfirmarEliminar = porId<HTMLButtonElement>('fmEliminarConfirmar');
let porEliminar: Registro | null = null;

const resumenSolicitud = (r: Registro) => {
  const s = r.respuestas;
  return `${typeof s.cantidad === 'number' ? cifra(s.cantidad) : ''} de ${s.material ?? ''} ${s.descripcion ?? ''}`.trim();
};

function abrirEliminacion(r: Registro) {
  porEliminar = r;
  // Vuelve al estado de confirmación (la ventana pudo quedar en "Eliminado correctamente").
  dialogoEliminar.classList.remove('eliminado');
  porId('fmEliminarTitulo').textContent = '¿Eliminar esta solicitud?';
  porId('fmEliminarTexto').textContent = `Se eliminará la solicitud de ${describir(r)} del ${formatoFecha.format(new Date(r.creado_en))}: ${resumenSolicitud(r)}. Esta acción no se puede deshacer.`;
  estadoEliminar.textContent = '';
  dialogoEliminar.showModal();
}

const cerrarEliminacion = () => { dialogoEliminar.close(); porEliminar = null; };
porId('fmEliminarCancelar').addEventListener('click', cerrarEliminacion);
porId('fmEliminarListo').addEventListener('click', cerrarEliminacion);
dialogoEliminar.addEventListener('click', evento => { if (evento.target === dialogoEliminar) cerrarEliminacion(); });
botonConfirmarEliminar.addEventListener('click', async () => {
  const registro = porEliminar;
  if (!registro) return;
  botonConfirmarEliminar.disabled = true;
  try {
    const respuesta = await fetch(`/api/solicitudes/${encodeURIComponent(registro.id)}`, { method: 'DELETE' });
    // Si ya no existía, para el usuario es lo mismo: deja de estar en la tabla.
    if (!respuesta.ok && respuesta.status !== 404) {
      const mensaje = await errorDeApi(respuesta, 'No se pudo eliminar la solicitud. Inténtalo de nuevo.');
      if (mensaje) estadoEliminar.textContent = mensaje;
      return;
    }
    if (registros) registros = registros.filter(r => r.id !== registro.id);
    pintarTablero();
    porEliminar = null;
    // El papel cae al bote, la tapa se cierra y aparece el chulo (animación en CSS, clase "eliminado").
    porId('fmEliminarTitulo').textContent = 'Eliminado correctamente';
    porId('fmEliminarTexto').textContent = `La solicitud de ${describir(registro)} del ${formatoFecha.format(new Date(registro.creado_en))} se eliminó.`;
    dialogoEliminar.classList.add('eliminado');
    porId('fmEliminarListo').focus();
    mostrarEstado(estadoTabla, `Se eliminó la solicitud de ${describir(registro)}.`, 'ok');
  } catch {
    estadoEliminar.textContent = SIN_CONEXION;
  } finally {
    botonConfirmarEliminar.disabled = false;
  }
});

// ---------- Pestañas: Nueva solicitud (formulario e historial) y Solicitudes (tablero) ----------

type Vista = 'nueva' | 'solicitudes';
const vistas: Record<Vista, HTMLElement> = { nueva: porId('soNueva'), solicitudes: porId('soListado') };
let vistaActual: Vista = 'nueva';

/** Muestra una pestaña y la marca arriba. #solicitudes en la dirección abre el tablero al recargar. */
function mostrarVista(vista: Vista, enfocar = false) {
  vistaActual = vista;
  document.body.dataset.vista = vista;
  for (const [nombre, seccion] of Object.entries(vistas)) seccion.hidden = nombre !== vista;
  for (const boton of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
    const activa = boton.dataset.view === vista;
    boton.classList.toggle('active', activa);
    if (activa) boton.setAttribute('aria-current', 'page'); else boton.removeAttribute('aria-current');
  }
  history.replaceState(null, '', vista === 'solicitudes' ? '#solicitudes' : location.pathname + location.search);
  if (vista === 'solicitudes' && registros) {
    for (const el of [kpi.sol, kpi.uni, kpi.cen]) el.dataset.valor = '0';
    pintarIndicadores(filtrados(registros));
  }
  if (enfocar) (vista === 'nueva' ? campos.entradas.centro : buscar).focus();
}
for (const boton of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
  boton.addEventListener('click', () => mostrarVista(boton.dataset.view as Vista));
}

// ---------- Carga ----------

function cargar(): Promise<void> {
  cargando ??= (async () => {
    mostrando.textContent = 'Consultando solicitudes…';
    mostrarEstado(estadoTabla, '');
    document.body.classList.add('so-cargando');
    try {
      const respuesta = await fetch('/api/solicitudes');
      if (respuesta.status === 401) { location.replace('/'); return; }
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.error || 'No se pudieron consultar las solicitudes.');
      registros = datos.solicitudes as Registro[];
      truncado = !!datos.truncado;
      fallaCarga = false;
      pagina = 0;
      pintarTablero();
    } catch (error) {
      fallaCarga = !registros;
      mostrando.textContent = 'No se pudieron cargar las solicitudes.';
      mostrarEstado(estadoTabla, error instanceof TypeError ? SIN_CONEXION : (error as Error).message, 'error');
      pintarHistorial();
    } finally {
      document.body.classList.remove('so-cargando');
      cargando = null;
    }
  })();
  return cargando;
}

porId('soCentros').replaceChildren(...CENTROS_DESTINO.map(c => new Option(`${c.cd} · ${c.solicitante}`, c.codigo)));
filtroCentro.append(...CENTROS_DESTINO.map(c => new Option(`${c.codigo} · ${c.cd}`, c.codigo)));
filtroFecha.value = claveDia(new Date());
mostrarVista(location.hash === '#solicitudes' ? 'solicitudes' : 'nueva');
enlazar(campos, pintarHistorial);
enlazar(edicion);
aprender([]);
refrescar(campos, false);
pintarHistorial();
pintarArticulos();
void cargar();

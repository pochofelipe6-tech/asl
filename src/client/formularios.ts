// Módulo Control de inventarios: llena el formulario por partes, resume el inventario por CD y lista las respuestas.
// Tema, usuario y cierre de sesión los maneja modulos.ts, cargado en la misma página.
import * as XLSX from 'xlsx';
import { porId } from './dom.ts';
import { CDS_REGIONAL_NORTE, FORMULARIOS, normalizarValor, preguntasDe, textoRespuesta, ultimoPorCd } from '../shared/formularios.ts';
import type { Pregunta } from '../shared/formularios.ts';

interface Registro { id: string; usuario_nombre: string; creado_en: string; respuestas: Record<string, unknown> }

const formulario = FORMULARIOS[0];
const preguntas = preguntasDe(formulario);
const POR_PAGINA = 15;

const form = porId<HTMLFormElement>('fmForm');
const secciones = porId('fmSecciones');
const pasos = porId<HTMLOListElement>('fmPasos');
const estadoForm = porId('fmEstado');
const botonAtras = porId<HTMLButtonElement>('fmPasoAtras');
const botonEnviar = porId<HTMLButtonElement>('fmEnviar');
const resumen = porId('fmResumen');
const estadoTabla = porId('fmTablaEstado');
const estadoResumen = porId('fmResumenEstado');
const buscar = porId<HTMLInputElement>('fmBuscar');
const tabla = porId<HTMLTableElement>('fmTabla');
const tablaCd = porId<HTMLTableElement>('fmTablaCd');
const anterior = porId<HTMLButtonElement>('fmAnterior');
const siguiente = porId<HTMLButtonElement>('fmSiguiente');
const textoPagina = porId('fmPagina');
const corte = porId<HTMLInputElement>('fmCorte');
const resCuerpo = porId('fmResCuerpo');
const resTabs = porId('fmResTabs');
const resPanel = porId('fmResPanel');
const resFaltan = porId('fmResFaltan');
const resDetalle = porId('fmResDetalle');
const resVacio = porId('fmResVacio');
const resVacioAccion = porId<HTMLButtonElement>('fmResVacioAccion');
const tooltip = porId('fmTooltip');
const guardado = porId<HTMLDialogElement>('fmGuardado');

let registros: Registro[] | null = null;
let truncado = false;
let pagina = 0;
let cargando: Promise<void> | null = null;

function crear<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function mostrarEstado(el: HTMLElement, texto: string, tipo: 'ok' | 'error' | '' = '') {
  el.textContent = texto;
  el.dataset.tipo = tipo;
}

const formatoFecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' });
const formatoDia = new Intl.DateTimeFormat('es-CO', { dateStyle: 'short' });
const formatoHora = new Intl.DateTimeFormat('es-CO', { timeStyle: 'short' });
const cifra = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const cifraCorta = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
const numero = (r: Registro | undefined, id: string) => { const v = r?.respuestas[id]; return typeof v === 'number' ? v : 0; };
const suma = (r: Registro | undefined, ids: readonly string[]) => ids.reduce((total, id) => total + numero(r, id), 0);
const nombreCorto = (p: Pregunta) => p.corto ?? p.titulo;
/** Primera pregunta de cada parte: ahí empieza un grupo de columnas en las tablas. */
const inicioDeParte = new Set(formulario.secciones.map(s => s.preguntas[0].id));

/** Momento de un reporte en palabras: "Hoy, 2:20 p. m.", "Ayer, 2:20 p. m." o "20/11/26, 2:20 p. m.". */
function cuando(iso: string): string {
  const fecha = new Date(iso);
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((dia(new Date()) - dia(fecha)) / 86400000);
  const hora = formatoHora.format(fecha);
  return dias === 0 ? `Hoy, ${hora}` : dias === 1 ? `Ayer, ${hora}` : `${formatoDia.format(fecha)}, ${hora}`;
}

// Ícono (trazos SVG fijos) e ilustración de cada parte, en el orden del formulario.
const PARTES = [
  { clave: 'cd', icono: '<path d="M12 21s-6.5-5.7-6.5-11.1a6.5 6.5 0 1 1 13 0C18.5 15.3 12 21 12 21Z"/><circle cx="12" cy="9.9" r="2.4"/>' },
  { clave: 'estibas', icono: '<path d="M3 15h18M3 19.5h18M4.5 15v4.5M12 15v4.5M19.5 15v4.5"/><path d="M5.5 15V9h6v6M12.5 15V5.5h6V15"/>' },
  { clave: 'hl', icono: '<path d="M12 3.2s6.2 6.6 6.2 11a6.2 6.2 0 0 1-12.4 0c0-4.4 6.2-11 6.2-11Z"/><path d="M9.3 14.6a2.8 2.8 0 0 0 2.7 2.6"/>' },
  { clave: 'cajas', icono: '<path d="M3.5 9h17v10.5h-17z"/><path d="M9.5 12.5h5M3.5 15.5h17"/><path d="M7 9V5.5M12 9V5.5M17 9V5.5"/>' },
] as const;
const TRAZOS = {
  chevron: '<path d="m9 6 6 6-6 6"/>',
  conReporte: '<circle cx="12" cy="12" r="9"/><path d="m8 12.4 2.7 2.7 5.3-5.6"/>',
  sinReporte: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
} as const;

/** Ícono SVG decorativo. Los trazos son fijos del código, nunca datos de usuarios. */
function icono(trazos: string, clase: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', clase);
  svg.innerHTML = trazos;
  return svg;
}

/** Ilustración de una parte, al lado derecho de su panel. Si el archivo no está, el panel se acomoda sin ese espacio. */
function ilustracion(clave: string, panel: HTMLElement): HTMLElement {
  const caja = crear('div', 'fm-ilustracion-caja');
  const imagen = Object.assign(crear('img', 'fm-ilustracion'), { src: `/img/formulario/${clave}.svg`, alt: '', decoding: 'async' });
  imagen.addEventListener('error', () => { caja.remove(); panel.classList.add('fm-sin-ilustracion'); });
  caja.append(imagen);
  return caja;
}

// ---------- Formulario por partes (una a la vez, como en el Microsoft Form) ----------

/** Control de una pregunta. El prefijo separa los ids del formulario principal (fm) y los de la ventana de edición (fme). */
function campo(p: Pregunta, prefijo = 'fm'): HTMLElement {
  const id = `${prefijo}-${p.id}`;
  if (p.tipo === 'lista') {
    const select = crear('select');
    select.append(new Option('Selecciona la respuesta', ''), ...(p.opciones ?? []).map(o => new Option(o, o)));
    Object.assign(select, { id, name: p.id, required: !!p.obligatoria });
    return select;
  }
  if (p.tipo === 'opcion') {
    const grupo = crear('div', 'fm-opciones');
    for (const opcion of p.opciones ?? []) {
      const etiqueta = crear('label', 'fm-opcion');
      const radio = Object.assign(crear('input'), { type: 'radio', name: p.id, value: opcion, required: !!p.obligatoria });
      etiqueta.append(radio, crear('span', undefined, opcion));
      grupo.append(etiqueta);
    }
    return grupo;
  }
  if (p.tipo === 'parrafo') return Object.assign(crear('textarea'), { id, name: p.id, rows: 4, maxLength: 4000, required: !!p.obligatoria });
  const input = Object.assign(crear('input'), { id, name: p.id, required: !!p.obligatoria, autocomplete: 'off' });
  if (p.tipo === 'numero') Object.assign(input, { type: 'text', inputMode: p.entero ? 'numeric' : 'decimal', placeholder: 'El valor debe ser un número.' });
  else if (p.tipo === 'fecha') input.type = 'date';
  else Object.assign(input, { type: 'text', maxLength: 500 });
  return input;
}

const bloques: HTMLFieldSetElement[] = [];
const ultimaParte = formulario.secciones.length - 1;
let actual = 0;
/** Parte más avanzada a la que ha llegado quien llena el formulario. */
let alcanzada = 0;

function armarFormulario() {
  porId('fmTitulo').textContent = formulario.titulo;
  porId('fmDescripcion').textContent = formulario.descripcion ?? '';
  let n = 0;
  formulario.secciones.forEach((seccion, i) => {
    const parte = PARTES[i];
    const bloque = crear('fieldset', 'fm-seccion');
    const leyenda = crear('legend');
    leyenda.append(crear('span', 'fm-parte-de', `Parte ${i + 1} de ${formulario.secciones.length}`), seccion.titulo);
    bloque.append(leyenda);
    if (seccion.descripcion) bloque.append(crear('p', 'fm-seccion-desc', seccion.descripcion));
    // Un solo panel por parte: círculo con el ícono, las preguntas y la ilustración.
    const panel = crear('div', 'fm-panel-parte');
    const circulo = crear('span', 'fm-parte-icono');
    if (parte) circulo.append(icono(parte.icono, 'fm-parte-svg'));
    const grilla = crear('div', 'fm-grilla');
    if (seccion.preguntas.length === 1) grilla.classList.add('fm-grilla-unica');
    panel.append(circulo, grilla);
    if (parte) panel.append(ilustracion(parte.clave, panel));
    for (const p of seccion.preguntas) {
      n += 1;
      const caja = crear('div', 'fm-pregunta');
      caja.dataset.pregunta = p.id;
      const enunciado = crear(p.tipo === 'opcion' ? 'span' : 'label', 'fm-enunciado');
      if (enunciado instanceof HTMLLabelElement) enunciado.htmlFor = `fm-${p.id}`;
      enunciado.append(crear('span', 'fm-num', `${n}.`), p.titulo);
      if (p.obligatoria) enunciado.append(crear('b', 'fm-req', '*'));
      const error = crear('p', 'fm-error');
      error.id = `fm-${p.id}-error`;
      const control = campo(p);
      control.setAttribute('aria-describedby', error.id);
      caja.append(enunciado, control, error);
      grilla.append(caja);
    }
    bloque.append(panel);
    bloques.push(bloque);
  });
  secciones.replaceChildren(...bloques);

  pasos.replaceChildren(...formulario.secciones.map((seccion, i) => {
    const item = crear('li', 'fm-paso');
    const boton = crear('button', 'fm-paso-boton');
    boton.type = 'button';
    const texto = crear('span', 'fm-paso-texto');
    texto.append(crear('strong', undefined, seccion.titulo), crear('small'));
    boton.append(crear('span', 'fm-paso-num', String(i + 1)), texto, icono(TRAZOS.chevron, 'fm-paso-chevron'));
    boton.addEventListener('click', () => irA(i));
    item.append(boton);
    return item;
  }));
  mostrarParte(0);
}

function valorDe(p: Pregunta, en: HTMLFormElement = form): unknown {
  const elemento = en.elements.namedItem(p.id);
  if (elemento instanceof RadioNodeList) return elemento.value;
  if (elemento instanceof HTMLInputElement && elemento.type === 'radio') return elemento.checked ? elemento.value : '';
  return elemento instanceof HTMLInputElement || elemento instanceof HTMLSelectElement || elemento instanceof HTMLTextAreaElement ? elemento.value : null;
}

function marcarError(p: Pregunta, mensaje: string) {
  const caja = secciones.querySelector<HTMLElement>(`[data-pregunta="${p.id}"]`);
  caja?.classList.toggle('fm-invalida', !!mensaje);
  const error = document.getElementById(`fm-${p.id}-error`);
  if (error) error.textContent = mensaje;
  caja?.querySelectorAll('input,select,textarea').forEach(c => c.setAttribute('aria-invalid', String(!!mensaje)));
}

/** Valida en el navegador con las mismas reglas del servidor. */
function validar(p: Pregunta): boolean {
  try { normalizarValor(p, valorDe(p)); marcarError(p, ''); return true; }
  catch (error) { marcarError(p, (error as Error).message); return false; }
}

const parteCompleta = (i: number) => formulario.secciones[i].preguntas.every(p => {
  try { normalizarValor(p, valorDe(p)); return true; } catch { return false; }
});

/** Valida una parte marcando sus errores. */
function validarParte(i: number): boolean {
  const invalidas = formulario.secciones[i].preguntas.filter(p => !validar(p));
  if (!invalidas.length) return true;
  mostrarEstado(estadoForm, invalidas.length === 1 ? 'Revisa la pregunta marcada.' : `Revisa las ${invalidas.length} preguntas marcadas.`, 'error');
  return false;
}

function pintarPasos() {
  const cd = valorDe(preguntas[0]);
  [...pasos.children].forEach((item, i) => {
    const estado = i === actual ? 'actual' : i <= alcanzada && parteCompleta(i) ? 'hecha' : 'pendiente';
    (item as HTMLElement).dataset.estado = estado;
    const boton = item.querySelector('button')!;
    if (i === actual) boton.setAttribute('aria-current', 'step'); else boton.removeAttribute('aria-current');
    item.querySelector('.fm-paso-num')!.textContent = estado === 'hecha' ? '✓' : String(i + 1);
    // En la primera parte se ve el CD elegido, para no reportar por error en otro centro.
    item.querySelector('small')!.textContent = i === 0 && typeof cd === 'string' && cd ? cd
      : estado === 'hecha' ? 'Completa' : estado === 'actual' ? 'En curso' : 'Pendiente';
  });
}

function mostrarParte(i: number, enfocar = false) {
  actual = i;
  alcanzada = Math.max(alcanzada, i);
  bloques.forEach((bloque, j) => { bloque.hidden = j !== i; });
  botonAtras.hidden = i === 0;
  form.toggleAttribute('data-ultimo', i === ultimaParte);
  pintarPasos();
  if (!enfocar) return;
  // Primero la pregunta con error; si no hay, la primera de la parte.
  const destino = bloques[i].querySelector<HTMLElement>('.fm-invalida :is(input,select,textarea)') ?? bloques[i].querySelector<HTMLElement>('input,select,textarea');
  destino?.focus({ preventScroll: true });
  if (form.getBoundingClientRect().top < 0) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Hacia atrás se va libre; hacia adelante solo con las partes anteriores completas. */
function irA(destino: number) {
  if (destino === actual || destino < 0 || destino > ultimaParte) return;
  mostrarEstado(estadoForm, '');
  for (let i = actual; i < destino; i++) {
    if (!validarParte(i)) { mostrarParte(i, true); return; }
  }
  mostrarParte(destino, true);
}

form.addEventListener('change', evento => {
  const nombre = (evento.target as HTMLInputElement).name;
  const p = preguntas.find(q => q.id === nombre);
  if (p) validar(p);
  pintarPasos();
});

botonAtras.addEventListener('click', () => irA(actual - 1));

function reiniciar() {
  form.reset();
  preguntas.forEach(p => marcarError(p, ''));
  alcanzada = 0;
  mostrarParte(0);
}

porId('fmLimpiar').addEventListener('click', () => {
  reiniciar();
  mostrarEstado(estadoForm, '');
});

form.addEventListener('submit', async evento => {
  evento.preventDefault();
  // Enter o "Siguiente" en una parte intermedia pasan a la siguiente parte.
  if (actual < ultimaParte) { irA(actual + 1); return; }
  for (let i = 0; i <= ultimaParte; i++) {
    if (!validarParte(i)) { mostrarParte(i, true); return; }
  }
  botonEnviar.disabled = true;
  mostrarEstado(estadoForm, 'Guardando respuesta…');
  try {
    const respuesta = await fetch('/api/formularios/respuestas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formulario: formulario.id, respuestas: Object.fromEntries(preguntas.map(p => [p.id, valorDe(p)])) }),
    });
    if (respuesta.status === 401) { location.replace('/'); return; }
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo guardar la respuesta. Inténtalo de nuevo.');
    if (registros && datos.respuesta) { registros.unshift(datos.respuesta); pintarTodo(); }
    const cd = valorDe(preguntas[0]);
    reiniciar();
    mostrarEstado(estadoForm, '');
    porId('fmGuardadoTexto').textContent = typeof cd === 'string' && cd ? `El reporte de ${cd} quedó registrado.` : 'El reporte quedó registrado.';
    guardado.showModal();
  } catch (error) {
    mostrarEstado(estadoForm, error instanceof TypeError ? 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.' : (error as Error).message, 'error');
  } finally {
    botonEnviar.disabled = false;
  }
});

// Tarjeta "Guardado": se cierra con Aceptar, con Escape o al hacer clic fuera de ella.
porId('fmGuardadoCerrar').addEventListener('click', () => guardado.close());
porId('fmGuardadoResumen').addEventListener('click', () => {
  guardado.close();
  document.querySelector<HTMLButtonElement>('button[data-view="resumen"]')?.click();
});
guardado.addEventListener('click', evento => { if (evento.target === guardado) guardado.close(); });

// ---------- Resumen: una pestaña por parte del formulario, con sus totales, su gráfico y la tabla por CD ----------

interface Serie { id: string; nombre: string }
function seriesDe(...idsPregunta: string[]): Serie[] {
  return idsPregunta.map(id => {
    const p = preguntas.find(q => q.id === id);
    if (!p) throw new Error(`El formulario no tiene la pregunta ${id}`);
    return { id, nombre: nombreCorto(p) };
  });
}
const SERIES = {
  estibas: seriesDe('estibas_a', 'estibas_b', 'estibas_c'),
  isotanques: [{ id: 'isotanques_llenos', nombre: 'Llenos' }, { id: 'isotanques_vacios', nombre: 'Vacíos' }],
  hl: seriesDe('hl_pendientes_verter'),
  cajas: seriesDe('cajas_330cc_x30', 'cajas_750cc_x16', 'cajas_1000cc_x13', 'cajas_250cc_x38', 'cajas_225cc_x38'),
};
const ids = (series: readonly Serie[]) => series.map(s => s.id);

type ClaveParte = (typeof PARTES)[number]['clave'];
const TOTAL_CDS = CDS_REGIONAL_NORTE.length;
/** Último reporte de cada CD con el que está pintado el resumen. Cada reporte es un conteo: no se suman los de un mismo CD. */
let ultimos = new Map<string, Registro>();
let pestana: ClaveParte = 'cd';

const totalDe = (series: readonly string[]) => { let total = 0; for (const r of ultimos.values()) total += suma(r, series); return total; };
const porcentaje = (parte: number, total: number) => `${total > 0 ? Math.round((parte / total) * 100) : 0} %`;
/** CD con reporte, en el orden del formulario. */
const cdsConReporte = () => CDS_REGIONAL_NORTE.filter(cd => ultimos.has(cd));

function hoyIso(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

/** Fin del día elegido; hoy (o vacío) significa "sin límite", para no dejar por fuera lo que entre después. */
function fechaCorte(): Date | undefined {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(corte.value);
  if (!partes || corte.value >= hoyIso()) return undefined;
  return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]) + 1);
}

// Tooltip compartido: los valores se insertan con textContent porque vienen de lo que escriben los usuarios.
interface FilaGrafico { cd: string; registro: Registro; valores: number[]; total: number }
function mostrarTooltip(fila: FilaGrafico, series: Serie[], x: number, y: number) {
  const contenido: HTMLElement[] = [crear('strong', 'fm-tt-titulo', fila.cd)];
  series.forEach((s, i) => {
    const linea = crear('span', 'fm-tt-fila');
    const clave = crear('i');
    clave.style.setProperty('--c', `var(--serie-${i + 1})`);
    linea.append(clave, crear('b', undefined, cifra(fila.valores[i])), crear('span', undefined, s.nombre));
    contenido.push(linea);
  });
  if (series.length > 1) {
    const linea = crear('span', 'fm-tt-fila fm-tt-total');
    linea.append(crear('b', undefined, cifra(fila.total)), crear('span', undefined, 'Total'));
    contenido.push(linea);
  }
  contenido.push(crear('span', 'fm-tt-pie', `Reporte: ${cuando(fila.registro.creado_en)} · ${fila.registro.usuario_nombre}`));
  tooltip.replaceChildren(...contenido);
  tooltip.hidden = false;
  const { offsetWidth: ancho, offsetHeight: alto } = tooltip;
  tooltip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - ancho - 8))}px`;
  tooltip.style.top = `${y + 14 + alto > innerHeight - 8 ? Math.max(8, y - alto - 10) : y + 14}px`;
}
/** Si el tooltip lo abrió el teclado, va pegado a una fila y se reubica al desplazar la página. */
let anclaTooltip: (() => void) | null = null;
const ocultarTooltip = () => { tooltip.hidden = true; anclaTooltip = null; };
addEventListener('scroll', () => { if (anclaTooltip && !tooltip.hidden) anclaTooltip(); else ocultarTooltip(); }, { passive: true });

let consecutivo = 0;

/** Marcas del eje de valores: de 0 a un tope "redondo" (0, 20, 40, 60). Con cantidades enteras no usa pasos con decimales. */
function marcasEje(maximo: number, enteros: boolean): number[] {
  if (!(maximo > 0)) return [0, 1];
  const bruto = maximo / 4;
  const potencia = Math.max(enteros ? 1 : 0, 10 ** Math.floor(Math.log10(bruto)));
  const pasos = [1, 2, 2.5, 5, 10].map(m => m * potencia).filter(p => !enteros || Number.isInteger(p));
  const paso = pasos.find(p => p >= bruto) ?? 10 * potencia;
  const intervalos = Math.max(1, Math.ceil(maximo / paso - 1e-9));
  return Array.from({ length: intervalos + 1 }, (_, i) => Number((i * paso).toFixed(6)));
}

/** Ancho aproximado de una cifra, en dígitos (los puntos y las comas ocupan la mitad): decide si cabe sobre su columna. */
const anchoCifra = (texto: string) => Math.ceil([...texto].reduce((a, c) => a + (/\d/.test(c) ? 1 : 0.5), 0));

/**
 * Columnas verticales agrupadas: un grupo por CD con reporte (de mayor a menor) y, dentro, una columna por serie,
 * todas desde la misma base y con el eje de valores a la izquierda. Los CD sin reporte no se dibujan.
 */
/**
 * Tope del eje cuando hay valores atípicos: si los más altos (hasta 3) superan más de 4 veces al siguiente,
 * el eje se ajusta a ese siguiente valor y esas columnas se dibujan recortadas. Devuelve null si no hace falta.
 */
function topeSinAtipicos(valores: number[]): number | null {
  const orden = valores.filter(v => v > 0).sort((a, b) => b - a);
  if (orden.length < 4) return null;
  for (let k = 1; k <= 3 && k < orden.length; k++) {
    if (orden[k - 1] > 4 * orden[k]) return orden[k];
  }
  return null;
}

interface OpcionesGrafico {
  /** Ícono junto al título. */
  icono?: string;
  /** Recorta las columnas atípicas para que se vean los demás CD (ver topeSinAtipicos). */
  recortar?: boolean;
  /** Una sola serie con énfasis: el CD más alto en el color de énfasis y los demás en gris. */
  enfasis?: { mayor: string; resto: string };
  /** Sin barra de desplazamiento: muestra los CD que caben en el ancho y unas flechas pasan a los siguientes. */
  paginar?: boolean;
}

function grafico(titulo: string, detalle: string, series: Serie[], opciones: OpcionesGrafico = {}): HTMLElement {
  const figura = crear('figure', 'fm-grafico');
  // Encabezado: ícono opcional, título con su detalle y la leyenda (en el tablero va a la derecha del título).
  const cabeza = crear('figcaption', 'fm-grafico-cabeza');
  if (opciones.icono) {
    const cuadro = crear('span', 'fm-tb-cuadro');
    cuadro.append(icono(opciones.icono, 'fm-ico'));
    cabeza.append(cuadro);
  }
  const titulos = crear('div', 'fm-grafico-titulos');
  titulos.append(crear('h4', undefined, titulo), crear('p', undefined, detalle));
  cabeza.append(titulos);
  const claves = opciones.enfasis
    ? [{ nombre: opciones.enfasis.mayor, color: 'var(--fm-enfasis)' }, { nombre: opciones.enfasis.resto, color: 'var(--fm-gris-dato)' }]
    : series.length > 1 ? series.map((s, i) => ({ nombre: s.nombre, color: `var(--serie-${i + 1})` })) : [];
  if (claves.length) {
    const lista = crear('ul', 'fm-leyenda');
    lista.append(...claves.map(clave => {
      const item = crear('li');
      const muestra = crear('i', 'fm-muestra');
      muestra.style.setProperty('--c', clave.color);
      item.append(muestra, clave.nombre);
      return item;
    }));
    cabeza.append(lista);
  }
  figura.append(cabeza);

  const filas: FilaGrafico[] = cdsConReporte().map(cd => {
    const registro = ultimos.get(cd)!;
    const valores = series.map(s => numero(registro, s.id));
    return { cd, registro, valores, total: valores.reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.total - a.total || a.cd.localeCompare(b.cd));
  const todos = filas.flatMap(f => f.valores);
  const sinAtipicos = opciones.recortar ? topeSinAtipicos(todos) : null;
  const maximo = Math.max(0, ...todos);
  const marcas = marcasEje(sinAtipicos ?? Math.max(0, ...todos), todos.every(Number.isInteger));
  const tope = marcas[marcas.length - 1];
  const recortadas = filas.flatMap(f => f.valores.some(v => v > tope) ? [`${f.cd} (${cifra(Math.max(...f.valores))})`] : []);
  figura.style.setProperty('--n', String(filas.length));
  // Las cifras van sobre las columnas solo si caben todas: se mide con la más larga del gráfico.
  const anchoMayor = String(Math.max(1, ...todos.filter(v => v > 0).map(v => anchoCifra(cifra(v)))));

  const eje = crear('div', 'fm-cols-eje');
  eje.setAttribute('aria-hidden', 'true');
  eje.append(...marcas.map(m => crear('span', undefined, cifra(m))));
  const lineas = crear('div', 'fm-cols-lineas');
  lineas.setAttribute('aria-hidden', 'true');
  lineas.append(...marcas.map(() => crear('i')));

  const grupos = crear('div', 'fm-cols-grupos');
  Object.assign(grupos, { tabIndex: 0, role: 'listbox' });
  grupos.setAttribute('aria-orientation', 'horizontal');
  grupos.setAttribute('aria-label', `${titulo}. Usa las flechas para recorrer los CD.`);
  let activa = -1;
  const elementos = filas.map((fila, i) => {
    const el = crear('div', 'fm-cols-grupo');
    el.id = `fm-grupo-${++consecutivo}`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', 'false');
    el.setAttribute('aria-label', `${fila.cd}: ${series.map((s, j) => `${s.nombre} ${cifra(fila.valores[j])}`).join(', ')}${series.length > 1 ? `, total ${cifra(fila.total)}` : ''}`);
    const barras = crear('span', 'fm-cols-barras');
    fila.valores.forEach((valor, j) => {
      // Cada serie conserva su lugar dentro del grupo aunque valga cero.
      const cortada = valor > tope;
      const columna = crear('span', valor > 0 ? (cortada ? 'fm-col fm-col-quiebre' : 'fm-col') : 'fm-col fm-col-cero');
      columna.style.setProperty('--c', opciones.enfasis ? (valor > 0 && valor === maximo ? 'var(--fm-enfasis)' : 'var(--fm-gris-dato)') : `var(--serie-${j + 1})`);
      columna.style.height = `${Math.min(valor / tope, 1) * 100}%`;
      if (valor > 0) {
        const etiqueta = crear('span', 'fm-col-valor', cifra(valor));
        etiqueta.dataset.ancho = anchoMayor;
        columna.append(etiqueta);
      }
      barras.append(columna);
    });
    el.append(barras, crear('span', 'fm-cols-cd', fila.cd));
    el.addEventListener('pointermove', evento => { anclaTooltip = null; mostrarTooltip(fila, series, evento.clientX, evento.clientY); });
    // Al hacer clic, el foco llega a la lista: que quede activo el CD tocado y no el primero.
    el.addEventListener('pointerdown', () => { activa = i; });
    return el;
  });
  grupos.append(...elementos);
  grupos.addEventListener('pointerleave', ocultarTooltip);

  // Páginas de CD: el eje es el mismo en todas (se calculó con todos los CD), así las alturas se comparan entre páginas.
  let porPagina = filas.length;
  let paginaCols = 0;
  const paginador = crear('div', 'fm-tb-paginas fm-cols-paginas');
  const flechaCols = (trazos: string, etiqueta: string) => {
    const boton = crear('button', 'pv-flecha');
    boton.type = 'button';
    boton.setAttribute('aria-label', etiqueta);
    boton.append(icono(trazos, 'pv-ico'));
    return boton;
  };
  const previos = flechaCols('<path d="m15 6-6 6 6 6"/>', 'Ver los CD anteriores');
  const proximos = flechaCols('<path d="m9 6 6 6-6 6"/>', 'Ver los CD siguientes');
  const rangoCols = crear('span', 'fm-tb-rango');
  rangoCols.setAttribute('aria-live', 'polite');
  paginador.append(previos, rangoCols, proximos);
  const mostrarPagina = () => {
    const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
    paginaCols = Math.min(Math.max(paginaCols, 0), paginas - 1);
    const desde = paginaCols * porPagina;
    const hasta = Math.min(desde + porPagina, filas.length);
    elementos.forEach((el, i) => { el.hidden = i < desde || i >= hasta; });
    figura.style.setProperty('--n', String(Math.max(1, hasta - desde)));
    rangoCols.textContent = `CD ${desde + 1}–${hasta} de ${filas.length}`;
    previos.disabled = paginaCols === 0;
    proximos.disabled = paginaCols >= paginas - 1;
    paginador.hidden = paginas <= 1;
  };
  if (opciones.paginar) {
    cabeza.append(paginador);
    previos.addEventListener('click', () => { paginaCols -= 1; ocultarTooltip(); mostrarPagina(); });
    proximos.addEventListener('click', () => { paginaCols += 1; ocultarTooltip(); mostrarPagina(); });
  }

  // Teclado: el gráfico es una sola parada de tabulación y las flechas recorren los CD.
  const activar = (i: number) => {
    activa = Math.max(0, Math.min(i, elementos.length - 1));
    // Si el CD está en otra página, se pasa a esa página.
    if (opciones.paginar && Math.floor(activa / porPagina) !== paginaCols) { paginaCols = Math.floor(activa / porPagina); mostrarPagina(); }
    elementos.forEach((el, j) => { el.classList.toggle('activa', j === activa); el.setAttribute('aria-selected', String(j === activa)); });
    const el = elementos[activa];
    const fila = filas[activa];
    grupos.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const ubicar = () => { const caja = el.getBoundingClientRect(); mostrarTooltip(fila, series, caja.left + caja.width / 2, caja.top + 20); };
    ubicar();
    anclaTooltip = ubicar;
  };
  grupos.addEventListener('focus', () => activar(Math.max(activa, 0)));
  grupos.addEventListener('blur', () => { elementos.forEach(el => el.classList.remove('activa')); ocultarTooltip(); });
  grupos.addEventListener('keydown', evento => {
    const teclas: Partial<Record<string, number>> = { ArrowRight: activa + 1, ArrowDown: activa + 1, ArrowLeft: activa - 1, ArrowUp: activa - 1, Home: 0, End: elementos.length - 1 };
    const destino = teclas[evento.key];
    if (destino !== undefined) { evento.preventDefault(); activar(destino); }
    else if (evento.key === 'Escape') ocultarTooltip();
  });

  const plano = crear('div', 'fm-cols-plano');
  plano.append(lineas, grupos);
  const cols = crear('div', 'fm-cols');
  cols.append(eje, plano);
  const caja = crear('div', 'fm-cols-caja');
  caja.append(cols);
  if (opciones.paginar) {
    // Cuántos CD caben: cada grupo necesita unos 64 px y el eje unos 58 px. El ancho de la caja no depende de la página.
    const paginarPorAncho = (ancho: number) => {
      const caben = Math.max(3, Math.floor((ancho - 58) / 64));
      // Páginas parejas: con 16 CD y 15 que caben, mejor 8 y 8 que 15 y 1.
      const nuevo = Math.ceil(filas.length / Math.ceil(filas.length / caben));
      if (nuevo === porPagina) return;
      const primero = paginaCols * porPagina;
      porPagina = nuevo;
      paginaCols = Math.floor(primero / porPagina);
      ocultarTooltip();
      mostrarPagina();
    };
    // Solo importa el ancho; el cambio de página se hace en el siguiente cuadro para no encadenar avisos del observador.
    let anchoVisto = 0;
    new ResizeObserver(([entrada]) => {
      const ancho = Math.round(entrada.contentRect.width);
      if (ancho === anchoVisto) return;
      anchoVisto = ancho;
      requestAnimationFrame(() => paginarPorAncho(ancho));
    }).observe(caja);
    mostrarPagina();
  }
  if (recortadas.length) {
    // La nota va dentro de la caja del gráfico para ocultarse junto con él en la vista Tabla.
    const nota = crear('p', 'fm-grafico-nota');
    nota.append(crear('i', 'fm-corte-muestra'), `${recortadas.length === 1 ? 'Columna recortada' : 'Columnas recortadas'} para que se vean los demás CD; su valor real va escrito encima: ${recortadas.join(', ')}.`);
    caja.append(nota);
  }
  figura.append(caja);
  return figura;
}

// Pestañas del resumen: las mismas píldoras del formulario, cada una con el ícono de su parte y su cifra principal.
const pestanas = new Map<ClaveParte, { caja: HTMLElement; boton: HTMLButtonElement; valor: HTMLElement; unidad: HTMLElement }>();

/** Variación en porcentaje con flecha y signo, como "↑ +12,6 %" (vista de HL). */
const textoCambio = (v: number) => `${v > 0.05 ? '↑ +' : v < -0.05 ? '↓ −' : '= '}${Math.abs(v).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;

function armarPestanas() {
  resTabs.replaceChildren(...PARTES.map((parte, i) => {
    const caja = crear('div', 'fm-paso');
    caja.setAttribute('role', 'presentation');
    const boton = crear('button', 'fm-paso-boton');
    Object.assign(boton, { type: 'button', id: `fmResTab-${parte.clave}` });
    boton.setAttribute('role', 'tab');
    boton.setAttribute('aria-controls', 'fmResPanel');
    const circulo = crear('span', 'fm-paso-num');
    circulo.append(icono(parte.icono, 'fm-ico'));
    const texto = crear('span', 'fm-paso-texto');
    const linea = crear('strong');
    const valor = crear('b');
    const unidad = crear('span');
    linea.append(valor, unidad);
    texto.append(crear('small', undefined, formulario.secciones[i]?.titulo ?? ''), linea);
    boton.append(circulo, texto, icono(TRAZOS.chevron, 'fm-paso-chevron'));
    boton.addEventListener('click', () => elegirPestana(parte.clave));
    caja.append(boton);
    pestanas.set(parte.clave, { caja, boton, valor, unidad });
    return caja;
  }));
  marcarPestanas();
}

function marcarPestanas() {
  for (const [clave, p] of pestanas) {
    const activa = clave === pestana;
    p.caja.dataset.estado = activa ? 'actual' : 'pendiente';
    p.boton.setAttribute('aria-selected', String(activa));
    p.boton.tabIndex = activa ? 0 : -1;
  }
  resPanel.setAttribute('aria-labelledby', `fmResTab-${pestana}`);
  // La tabla completa por CD solo va en la pestaña Centro De Distribución; las demás muestran su gráfico.
  resDetalle.hidden = pestana !== 'cd';
}

function elegirPestana(clave: ClaveParte, enfocar = false) {
  pestana = clave;
  marcarPestanas();
  ocultarTooltip();
  if (ultimos.size) pintarPanel();
  if (!enfocar) return;
  const boton = pestanas.get(clave)?.boton;
  boton?.focus({ preventScroll: true });
  boton?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Flechas, Inicio y Fin recorren las pestañas, como en cualquier lista de pestañas.
resTabs.addEventListener('keydown', evento => {
  const orden = PARTES.map(p => p.clave);
  const i = orden.indexOf(pestana);
  const destinos: Partial<Record<string, number>> = { ArrowRight: (i + 1) % orden.length, ArrowLeft: (i + orden.length - 1) % orden.length, Home: 0, End: orden.length - 1 };
  const destino = destinos[evento.key];
  if (destino === undefined) return;
  evento.preventDefault();
  elegirPestana(orden[destino], true);
});

function pintarPestanas() {
  const poner = (clave: ClaveParte, valor: string, unidad: string) => {
    const p = pestanas.get(clave);
    if (p) { p.valor.textContent = valor; p.unidad.textContent = unidad; }
  };
  poner('cd', `${ultimos.size} de ${TOTAL_CDS}`, 'con reporte');
  poner('estibas', cifra(totalDe(ids(SERIES.estibas))), 'unidades');
  poner('hl', cifra(totalDe(ids(SERIES.hl))), 'HL por verter');
  poner('cajas', cifra(totalDe(ids(SERIES.cajas))), 'unidades');
}

/** Aviso de los CD que faltan, con un enlace a la pestaña donde se ven. */
function notaFaltan(singular: string, plural: string): HTMLElement | null {
  const faltan = TOTAL_CDS - ultimos.size;
  if (!faltan) return null;
  const nota = crear('p', 'fm-res-nota');
  const enlace = crear('button', 'fm-enlace', 'Ver cuáles');
  enlace.type = 'button';
  enlace.addEventListener('click', () => elegirPestana('cd', true));
  nota.append(icono(TRAZOS.sinReporte, 'fm-ico'), crear('span', undefined, faltan === 1 ? `Falta 1 CD por reportar; ${singular}.` : `Faltan ${faltan} CD por reportar; ${plural}.`), enlace);
  return nota;
}

function grupo(titulo: string, contenido: HTMLElement): HTMLElement {
  const caja = crear('div', 'fm-res-grupo');
  caja.append(crear('h4', 'fm-res-sub', titulo), contenido);
  return caja;
}

/** Parte 1: cuántos CD han reportado, cuándo lo hizo cada uno y cuáles faltan. */
function contenidoCd(): HTMLElement {
  const caja = crear('div', 'fm-res-cobertura');
  const conReporte = cdsConReporte();
  const sinReporte = CDS_REGIONAL_NORTE.filter(cd => !ultimos.has(cd));

  const arriba = crear('div', 'fm-res-cob-top');
  const cobertura = crear('p', 'fm-res-cob-cifra');
  cobertura.append(crear('strong', 'fm-res-heroe', String(ultimos.size)), crear('span', undefined, `de ${TOTAL_CDS} CD con reporte`));
  const avance = crear('div', 'fm-res-cob-avance');
  const medidor = crear('div', 'fm-res-medidor');
  medidor.setAttribute('role', 'meter');
  medidor.setAttribute('aria-label', 'CD con reporte');
  medidor.setAttribute('aria-valuemin', '0');
  medidor.setAttribute('aria-valuemax', String(TOTAL_CDS));
  medidor.setAttribute('aria-valuenow', String(ultimos.size));
  for (let i = 0; i < TOTAL_CDS; i++) medidor.append(crear('i', i < ultimos.size ? 'lleno' : undefined));
  const pie = crear('p', 'fm-res-cob-pie');
  pie.append(crear('b', undefined, `${porcentaje(ultimos.size, TOTAL_CDS)} de la regional`));
  const reciente = conReporte.map(cd => ({ cd, r: ultimos.get(cd)! })).sort((a, b) => Date.parse(b.r.creado_en) - Date.parse(a.r.creado_en)).at(0);
  if (reciente) pie.append(crear('span', undefined, `Último reporte: ${cuando(reciente.r.creado_en)} · ${reciente.cd}`));
  avance.append(medidor, pie);
  arriba.append(cobertura, avance);
  caja.append(arriba);

  const lista = crear('ul', 'fm-res-cds');
  lista.append(...conReporte.map(cd => {
    const r = ultimos.get(cd)!;
    const item = crear('li', 'fm-res-cd');
    const fecha = crear('span', 'fm-res-cd-cuando');
    fecha.append(icono(TRAZOS.conReporte, 'fm-ico'), cuando(r.creado_en));
    item.append(crear('strong', undefined, cd), fecha, crear('span', 'fm-res-cd-quien', r.usuario_nombre));
    return item;
  }));
  caja.append(grupo(`Con reporte (${conReporte.length})`, lista));

  if (sinReporte.length) {
    const chips = crear('ul', 'fm-res-chips');
    chips.append(...sinReporte.map(cd => {
      const chip = crear('li', 'fm-res-chip');
      chip.append(icono(TRAZOS.sinReporte, 'fm-ico'), cd);
      return chip;
    }));
    caja.append(grupo(`Sin reporte (${sinReporte.length})`, chips));
  }
  return caja;
}

// ---------- Tablero de una categoría (Estibas, Cajas plásticas): encabezado con foto, cifras, gráfico, detalle e indicadores ----------

interface ConfigTablero {
  titulo: string;
  subtitulo: string;
  /** Cifra principal de la regional, por ejemplo "Estibas en la regional". */
  etiquetaTotal: string;
  /** Unidad en plural y en minúscula, por ejemplo "estibas". */
  unidad: string;
  /** Series que suman la cifra principal. */
  series: Serie[];
  graficoTitulo: string;
  graficoDetalle: string;
  /** Título de la tarjeta de reparto: "Distribución por tipo", "Distribución por referencia". */
  distribucion: string;
  /** Indicador clave de participación: la serie con más unidades o el CD con más unidades. */
  participacion: 'serie' | 'lider';
  /** Nombre de la hoja y del archivo de Excel. */
  archivo: string;
}
const TABLEROS: Partial<Record<ClaveParte, ConfigTablero>> = {
  estibas: {
    titulo: 'Información de estibas',
    subtitulo: 'Resumen general y distribución por tipo de estiba',
    etiquetaTotal: 'Estibas en la regional',
    unidad: 'estibas',
    series: SERIES.estibas,
    graficoTitulo: 'Estibas por CD',
    graficoDetalle: 'Cantidad de estibas por centro de distribución',
    distribucion: 'Distribución por tipo',
    participacion: 'serie',
    archivo: 'Estibas',
  },
  cajas: {
    titulo: 'Información de cajas plásticas',
    subtitulo: 'Resumen general y distribución por referencia',
    etiquetaTotal: 'Cajas plásticas en la regional',
    unidad: 'cajas',
    series: SERIES.cajas,
    graficoTitulo: 'Cajas plásticas por CD',
    graficoDetalle: 'Unidades por referencia en cada CD',
    distribucion: 'Distribución por referencia',
    participacion: 'lider',
    archivo: 'Cajas_plasticas',
  },
};
const TRAZOS_TABLERO = {
  calendario: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  promedio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>',
  columnas: '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/>',
  tabla: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 14.5h18M9 9.5V20"/>',
  buscar: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  exportar: '<path d="M12 4v11m0 0-4.2-4.2M12 15l4.2-4.2M5 20h14"/>',
  trofeo: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7"/>',
  tendencia: '<path d="M4 17l5-5 4 4 7-7"/><path d="M15 9h5v5"/>',
  torta: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15z"/>',
  alerta: '<path d="M12 4 2.8 20h18.4z"/><path d="M12 10v4.5M12 17.3v.2"/>',
  bien: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  indicadores: '<path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6z"/><path d="m8.8 12 2.3 2.3 4.2-4.6"/>',
  isotanque: '<rect x="4.5" y="4" width="15" height="13" rx="1.5"/><path d="M4.5 9.5h15M4.5 13h15M9.5 4v13M14.5 4v13M3.5 20h17M6 17v3M18 17v3"/>',
  actualizar: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5v4h-4"/>',
} as const;

const porcentajeCorto = (parte: number, total: number) => `${(total > 0 ? (parte / total) * 100 : 0).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;

/**
 * Variación frente al cierre del día anterior al corte, en porcentaje. Solo compara los CD que ya tenían
 * reporte ese día: si se sumaran los CD que reportaron por primera vez hoy, el aumento sería engañoso.
 * Es null cuando no hay con qué comparar (no se inventa una cifra).
 */
function variacionDiaAnterior(idsSerie: readonly string[]): number | null {
  if (!registros) return null;
  const hasta = fechaCorte();
  const base = hasta ?? (() => { const hoy = new Date(); return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1); })();
  const inicioDelDia = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
  let antes = 0;
  let ahora = 0;
  for (const [cd, previo] of ultimoPorCd(registros, inicioDelDia)) {
    const actual = ultimos.get(cd);
    if (!actual) continue;
    antes += suma(previo, idsSerie);
    ahora += suma(actual, idsSerie);
  }
  return antes > 0 ? ((ahora - antes) / antes) * 100 : null;
}

function cuadroIcono(trazos: string, clase = 'fm-tb-cuadro'): HTMLElement {
  const cuadro = crear('span', clase);
  cuadro.append(icono(trazos, 'fm-ico'));
  return cuadro;
}

/** Dona de reparto con una cifra en el centro (el total, si no se indica otra). Cada parte deja 2 px de separación. */
function dona(series: Serie[], valores: number[], total: number, centro = { valor: cifra(total), texto: 'Total' }): HTMLElement {
  const caja = crear('div', 'fm-tb-dona');
  caja.setAttribute('role', 'img');
  caja.setAttribute('aria-label', `Distribución: ${series.map((s, i) => `${s.nombre} ${cifra(valores[i])} (${porcentaje(valores[i], total)})`).join(', ')}`);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  const radio = 48;
  const vuelta = 2 * Math.PI * radio;
  const pista = document.createElementNS(NS, 'circle');
  Object.entries({ cx: '60', cy: '60', r: String(radio), class: 'fm-tb-dona-pista' }).forEach(([k, v]) => pista.setAttribute(k, v));
  svg.append(pista);
  const conValor = valores.filter(v => v > 0).length;
  const separacion = conValor > 1 ? 2 : 0;
  let recorrido = 0;
  valores.forEach((valor, i) => {
    if (valor <= 0 || total <= 0) return;
    const largo = (valor / total) * vuelta;
    const arco = document.createElementNS(NS, 'circle');
    Object.entries({ cx: '60', cy: '60', r: String(radio), class: 'fm-tb-dona-arco' }).forEach(([k, v]) => arco.setAttribute(k, v));
    arco.style.setProperty('--c', `var(--serie-${i + 1})`);
    arco.setAttribute('stroke-dasharray', `${Math.max(0, largo - separacion)} ${vuelta}`);
    arco.setAttribute('stroke-dashoffset', String(-recorrido));
    svg.append(arco);
    recorrido += largo;
  });
  const medio = crear('span', 'fm-tb-dona-centro');
  medio.append(crear('strong', undefined, centro.valor), crear('small', undefined, centro.texto));
  caja.append(svg, medio);
  return caja;
}

/** CD con el valor más alto de unas preguntas, como "Apartado (22)". */
function cdConMas(idsPregunta: readonly string[]): string {
  let mejor = '';
  let maximo = 0;
  for (const cd of cdsConReporte()) {
    const valor = suma(ultimos.get(cd), idsPregunta);
    if (valor > maximo) { maximo = valor; mejor = cd; }
  }
  return mejor ? `${mejor} (${cifra(maximo)})` : '—';
}

/** Botón con la fecha del corte que abre el calendario del filtro "Inventario al". */
function botonFecha(clase: string, texto: string): HTMLButtonElement {
  const fecha = crear('button', clase);
  fecha.type = 'button';
  fecha.append(icono(TRAZOS_TABLERO.calendario, 'fm-ico'), texto, icono('<path d="m6 9 6 6 6-6"/>', 'fm-ico'));
  fecha.setAttribute('aria-label', `Inventario al ${texto}. Cambiar la fecha`);
  fecha.addEventListener('click', () => { try { corte.showPicker(); } catch { corte.focus(); } });
  return fecha;
}

interface FilaTablero { cd: string; registro: Registro; valores: number[]; total: number }

/** Vista elegida en el gráfico del tablero (Gráfico o Tabla); se conserva al repintar. */
let vistaTablaTablero = false;

function tablero(cfg: ConfigTablero, indice: number, clave: ClaveParte): HTMLElement {
  const idsSerie = ids(cfg.series);
  const filas: FilaTablero[] = cdsConReporte().map(cd => {
    const registro = ultimos.get(cd)!;
    const valores = cfg.series.map(s => numero(registro, s.id));
    return { cd, registro, valores, total: valores.reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.total - a.total || a.cd.localeCompare(b.cd));
  const totales = cfg.series.map((_, j) => filas.reduce((t, f) => t + f.valores[j], 0));
  const total = totales.reduce((a, b) => a + b, 0);
  const promedio = filas.length ? total / filas.length : 0;
  const lider = filas[0];
  // La referencia es el CD típico (la mediana) y no el promedio: un solo CD con mucho no debe dejar a todos en "Atención".
  const ordenados = filas.map(f => f.total).sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  const mediana = !ordenados.length ? 0 : ordenados.length % 2 ? ordenados[mitad] : (ordenados[mitad - 1] + ordenados[mitad]) / 2;
  const umbral = mediana / 2;
  // Un CD que reportó pero dejó todo vacío o en cero queda "Sin datos"; si tiene poco, "Atención".
  const sinDatos = (f: FilaTablero) => f.total <= 0;
  const enAtencion = (f: FilaTablero) => !sinDatos(f) && f.total < umbral;
  const textoEstado = (f: FilaTablero) => sinDatos(f) ? 'Sin datos' : enAtencion(f) ? 'Atención' : 'Óptimo';
  const variacion = variacionDiaAnterior(idsSerie);
  const textoVariacion = variacion === null ? null
    : `${variacion > 0.05 ? '↑' : variacion < -0.05 ? '↓' : '='} ${Math.abs(variacion).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
  const parte = PARTES[indice];
  const raiz = crear('div', 'fm-tb');

  // Encabezado con foto: parte, título, subtítulo y la fecha del corte.
  const cabeza = crear('div', 'fm-tb-cabeza');
  const titulos = crear('div');
  const h3 = crear('h3', 'fm-res-titulo');
  h3.append(crear('span', 'fm-parte-de', `Parte ${indice + 1} de ${PARTES.length}`), cfg.titulo);
  titulos.append(h3, crear('p', undefined, cfg.subtitulo));
  const esHoy = !corte.value || corte.value >= hoyIso();
  cabeza.append(titulos, botonFecha('fm-tb-fecha', esHoy ? 'Hoy' : formatoDia.format(new Date(`${corte.value}T12:00:00`))));
  raiz.append(cabeza);

  // Fila de tarjetas.
  const kpis = crear('div', 'fm-tb-kpis');
  const rojo = crear('div', 'fm-tb-kpi fm-tb-rojo');
  const delta = crear('span', 'fm-tb-delta');
  delta.append(crear('b', undefined, textoVariacion ?? 'Sin dato'), crear('small', undefined, textoVariacion ? 'vs. cierre del día anterior' : 'no hay corte anterior para comparar'));
  rojo.append(cuadroIcono(parte.icono, 'fm-tb-cuadro fm-tb-cuadro-claro'), crear('span', 'fm-tb-etiqueta', cfg.etiquetaTotal),
    crear('strong', 'fm-tb-grande', cifra(total)), crear('span', 'fm-tb-unidad', 'unidades'), delta);

  const azul = crear('div', 'fm-tb-kpi fm-tb-azul');
  const izquierda = crear('div', 'fm-tb-azul-izq');
  const encabezadoAzul = crear('span', 'fm-tb-etiqueta');
  encabezadoAzul.append(cuadroIcono(TRAZOS_TABLERO.promedio, 'fm-tb-circulo'), 'Promedio por CD');
  izquierda.append(encabezadoAzul, crear('strong', 'fm-tb-medio', cifraCorta(promedio)), crear('span', 'fm-tb-unidad', cfg.unidad));
  const derecha = crear('div', 'fm-tb-azul-der');
  derecha.append(crear('span', 'fm-tb-mini', `CD con más ${cfg.unidad}`), crear('strong', undefined, lider?.cd ?? '—'), crear('span', 'fm-tb-pastilla', lider ? cifra(lider.total) : '0'));
  azul.append(izquierda, derecha);

  const reparto = crear('div', 'fm-tb-kpi fm-tb-reparto');
  const lista = crear('ul', 'fm-tb-leyenda');
  lista.append(...cfg.series.map((s, j) => {
    const item = crear('li');
    const muestra = crear('i', 'fm-muestra');
    muestra.style.setProperty('--c', `var(--serie-${j + 1})`);
    item.append(muestra, crear('span', undefined, s.nombre), crear('b', undefined, cifra(totales[j])), crear('em', undefined, porcentaje(totales[j], total)));
    return item;
  }));
  const cuerpoReparto = crear('div', 'fm-tb-reparto-cuerpo');
  cuerpoReparto.append(dona(cfg.series, totales, total), lista);
  reparto.append(crear('h4', undefined, cfg.distribucion), cuerpoReparto);

  const imagen = crear('div', 'fm-tb-kpi fm-tb-imagen');
  imagen.append(ilustracion(clave, imagen));
  kpis.append(rojo, azul, reparto, imagen);
  raiz.append(kpis);

  // Gráfico por CD, con el conmutador Gráfico | Tabla (la tabla muestra los mismos valores, uno por celda).
  const tarjetaGrafico = crear('div', 'fm-tb-card fm-tb-con-vista');
  const figura = grafico(cfg.graficoTitulo, cfg.graficoDetalle, cfg.series, { icono: TRAZOS_TABLERO.columnas });
  const vistaTabla = crear('div', 'fm-tb-tabla-caja fm-tb-vista-tabla');
  const tablaValores = crear('table', 'fm-tb-tabla');
  const cabezaValores = crear('tr');
  cabezaValores.append(...['CD', ...cfg.series.map(s => s.nombre), 'Total'].map((texto, j) => Object.assign(crear('th', j ? 'num' : undefined, texto), { scope: 'col' })));
  tablaValores.createTHead().append(cabezaValores);
  tablaValores.createTBody().append(...filas.map(f => {
    const tr = crear('tr');
    tr.append(Object.assign(crear('th', undefined, f.cd), { scope: 'row' }), ...f.valores.map(v => crear('td', 'num', cifra(v))), crear('td', 'num total', cifra(f.total)));
    return tr;
  }));
  vistaTabla.append(tablaValores);
  const columnas = figura.querySelector('.fm-cols-caja');
  const ver = (tabla: boolean) => { columnas?.toggleAttribute('hidden', tabla); vistaTabla.hidden = !tabla; };
  const conmutador = crear('div', 'fm-tb-conmutador');
  conmutador.setAttribute('role', 'group');
  conmutador.setAttribute('aria-label', 'Cómo ver los datos por CD');
  const botonesVista = [{ texto: 'Gráfico', trazos: TRAZOS_TABLERO.columnas, tabla: false }, { texto: 'Tabla', trazos: TRAZOS_TABLERO.tabla, tabla: true }].map(opcion => {
    const boton = crear('button', 'fm-tb-opcion');
    boton.type = 'button';
    boton.append(icono(opcion.trazos, 'fm-ico'), opcion.texto);
    boton.setAttribute('aria-pressed', String(opcion.tabla === vistaTablaTablero));
    boton.addEventListener('click', () => {
      vistaTablaTablero = opcion.tabla;
      botonesVista.forEach(b => b.setAttribute('aria-pressed', String(b === boton)));
      ocultarTooltip();
      ver(opcion.tabla);
    });
    return boton;
  });
  conmutador.append(...botonesVista);
  figura.querySelector('.fm-grafico-cabeza')?.append(conmutador);
  figura.append(vistaTabla);
  ver(vistaTablaTablero);
  tarjetaGrafico.append(figura);
  raiz.append(tarjetaGrafico);

  // Detalle por CD (con flechas, buscador y exportar) e indicadores clave.
  const abajo = crear('div', 'fm-tb-abajo');
  const detalle = crear('section', 'fm-tb-card fm-tb-detalle');
  const idTitulo = `fmTbDetalle-${clave}`;
  const cabezaDetalle = crear('div', 'fm-tb-card-cabeza');
  const tituloDetalle = crear('h4', undefined, 'Detalle por CD');
  tituloDetalle.id = idTitulo;
  detalle.setAttribute('aria-labelledby', idTitulo);
  const buscador = crear('label', 'fm-tb-buscar');
  const campoBuscar = Object.assign(crear('input'), { type: 'search', placeholder: 'Buscar un CD…', autocomplete: 'off' });
  campoBuscar.setAttribute('aria-label', 'Buscar un CD en el detalle');
  buscador.append(icono(TRAZOS_TABLERO.buscar, 'fm-ico'), campoBuscar);
  const exportar = crear('button', 'pv-btn fm-btn-sec fm-tb-exportar');
  exportar.type = 'button';
  exportar.append(icono(TRAZOS_TABLERO.exportar, 'fm-ico'), 'Exportar');
  // Sin barra de desplazamiento: la tabla muestra 5 CD y las flechas pasan a los siguientes.
  const POR_PAGINA_DETALLE = 5;
  let paginaDetalle = 0;
  const paginador = crear('div', 'fm-tb-paginas');
  const flecha = (trazos: string, etiqueta: string) => {
    const boton = crear('button', 'pv-flecha');
    boton.type = 'button';
    boton.setAttribute('aria-label', etiqueta);
    boton.append(icono(trazos, 'pv-ico'));
    return boton;
  };
  const anteriores = flecha('<path d="m6 15 6-6 6 6"/>', 'Ver los CD anteriores');
  const siguientes = flecha('<path d="m6 9 6 6 6-6"/>', 'Ver los CD siguientes');
  const rango = crear('span', 'fm-tb-rango');
  rango.setAttribute('aria-live', 'polite');
  paginador.append(anteriores, rango, siguientes);
  cabezaDetalle.append(cuadroIcono(TRAZOS_TABLERO.tabla), tituloDetalle, paginador, buscador, exportar);

  const tabla = crear('table', 'fm-tb-tabla');
  const filaCabeza = crear('tr');
  filaCabeza.append(...['CD', ...cfg.series.map(s => s.nombre), 'Total', '% Participación', 'Estado'].map((texto, j) =>
    Object.assign(crear('th', j > 0 && j <= cfg.series.length + 2 ? 'num' : undefined, texto), { scope: 'col' })));
  tabla.createTHead().append(filaCabeza);
  const cuerpo = tabla.createTBody();
  const estado = (f: FilaTablero) => {
    const tipo = sinDatos(f) ? 'sin-datos' : enAtencion(f) ? 'atencion' : 'bien';
    const chip = crear('span', `fm-tb-estado ${tipo}`);
    chip.append(icono(tipo === 'bien' ? TRAZOS_TABLERO.bien : tipo === 'atencion' ? TRAZOS_TABLERO.alerta : TRAZOS.sinReporte, 'fm-ico'), textoEstado(f));
    return chip;
  };
  // % de participación con una barra fina, comparada con el CD que más tiene (el texto lleva el valor exacto).
  const mayorTotal = Math.max(0, ...filas.map(f => f.total));
  const participacionCelda = (f: FilaTablero) => {
    const celda = crear('td', 'num fm-tb-part');
    const barra = crear('i');
    barra.setAttribute('aria-hidden', 'true');
    barra.style.setProperty('--p', String(mayorTotal > 0 ? f.total / mayorTotal : 0));
    celda.append(barra, porcentajeCorto(f.total, total));
    return celda;
  };
  const sinCoincidencias = crear('p', 'fm-tb-vacio', 'Ningún CD coincide con la búsqueda.');
  const pintarFilas = () => {
    const consulta = campoBuscar.value.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const visibles = filas.filter(f => f.cd.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(consulta));
    const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA_DETALLE));
    paginaDetalle = Math.min(Math.max(paginaDetalle, 0), paginas - 1);
    const desde = paginaDetalle * POR_PAGINA_DETALLE;
    const pagina = visibles.slice(desde, desde + POR_PAGINA_DETALLE);
    rango.textContent = visibles.length ? `CD ${desde + 1}–${desde + pagina.length} de ${visibles.length}` : 'Sin resultados';
    anteriores.disabled = paginaDetalle === 0;
    siguientes.disabled = paginaDetalle >= paginas - 1;
    paginador.hidden = visibles.length <= POR_PAGINA_DETALLE;
    cuerpo.replaceChildren(...pagina.map(f => {
      const tr = crear('tr');
      const celdaEstado = crear('td');
      celdaEstado.append(estado(f));
      tr.append(Object.assign(crear('th', undefined, f.cd), { scope: 'row' }),
        ...f.valores.map(v => crear('td', 'num', cifra(v))),
        crear('td', 'num total', cifra(f.total)),
        participacionCelda(f),
        celdaEstado);
      return tr;
    }));
    sinCoincidencias.hidden = visibles.length > 0;
  };
  pintarFilas();
  campoBuscar.addEventListener('input', () => { paginaDetalle = 0; pintarFilas(); });
  anteriores.addEventListener('click', () => { paginaDetalle -= 1; pintarFilas(); });
  siguientes.addEventListener('click', () => { paginaDetalle += 1; pintarFilas(); });
  const pie = crear('tr');
  pie.append(Object.assign(crear('th', undefined, 'Total regional'), { scope: 'row' }),
    ...totales.map(v => crear('td', 'num', cifra(v))), crear('td', 'num total', cifra(total)), crear('td', 'num', '100 %'), crear('td'));
  tabla.createTFoot().append(pie);
  const cajaTabla = crear('div', 'fm-tb-tabla-caja');
  cajaTabla.append(tabla);
  const regla = crear('p', 'fm-tb-regla');
  regla.append(icono(TRAZOS_TABLERO.alerta, 'fm-ico'), `Atención: el CD tiene menos de la mitad de lo que tiene el CD típico de la regional (menos de ${cifraCorta(umbral)} ${cfg.unidad}). Sin datos: el CD reportó, pero no llenó ninguna cantidad.`);
  detalle.append(cabezaDetalle, cajaTabla, sinCoincidencias, regla);
  const nota = notaFaltan('no aparece en el detalle', 'no aparecen en el detalle');
  if (nota) detalle.append(nota);

  exportar.addEventListener('click', () => {
    const encabezados = ['CD', ...cfg.series.map(s => s.nombre), 'Total', '% Participación', 'Estado', 'Último reporte', 'Registrado por'];
    const datos = filas.map(f => [f.cd, ...f.valores, f.total, total > 0 ? Math.round((f.total / total) * 1000) / 10 : 0,
      textoEstado(f), formatoFecha.format(new Date(f.registro.creado_en)), f.registro.usuario_nombre]);
    const hoja = XLSX.utils.aoa_to_sheet([encabezados, ...datos, ['Total regional', ...totales, total, 100, '', '', '']]);
    hoja['!cols'] = encabezados.map((e, j) => ({ wch: j === 0 ? 16 : Math.max(10, e.length + 2) }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, cfg.archivo);
    XLSX.writeFile(libro, `${cfg.archivo}_por_CD_${corte.value || hoyIso()}.xlsx`);
  });

  const indicadores = crear('section', 'fm-tb-card fm-tb-indicadores');
  const cabezaInd = crear('div', 'fm-tb-card-cabeza');
  cabezaInd.append(cuadroIcono(TRAZOS_TABLERO.indicadores), crear('h4', undefined, 'Indicadores clave'));
  const principalTipo = cfg.series.map((s, j) => ({ s, v: totales[j] })).sort((a, b) => b.v - a.v)[0];
  const participacion = cfg.participacion === 'lider'
    ? { etiqueta: lider ? `Participación de ${lider.cd}` : 'Participación', valor: lider ? porcentajeCorto(lider.total, total) : '—' }
    : { etiqueta: principalTipo ? `Participación ${principalTipo.s.nombre}` : 'Participación', valor: principalTipo ? porcentaje(principalTipo.v, total) : '—' };
  const cuantosAtencion = filas.filter(enAtencion).length;
  const listaInd = crear('ul', 'fm-tb-ind-lista');
  const indicador = (trazos: string, clase: string, etiqueta: string, valor: string) => {
    const li = crear('li');
    const textos = crear('span');
    textos.append(crear('small', undefined, etiqueta), crear('b', undefined, valor));
    li.append(cuadroIcono(trazos, `fm-tb-circulo ${clase}`), textos);
    return li;
  };
  listaInd.append(
    indicador(TRAZOS_TABLERO.trofeo, 'oro', `CD con más ${cfg.unidad}`, lider ? `${lider.cd} (${cifra(lider.total)})` : '—'),
    indicador(TRAZOS_TABLERO.tendencia, 'verde', 'Variación vs. día anterior', textoVariacion ?? 'Sin corte anterior'),
    indicador(TRAZOS_TABLERO.torta, 'azul', participacion.etiqueta, participacion.valor),
    indicador(TRAZOS_TABLERO.alerta, 'ambar', 'CD en atención', `${cuantosAtencion} de ${filas.length}`),
  );
  indicadores.append(cabezaInd, listaInd);
  abajo.append(detalle, indicadores);
  raiz.append(abajo);
  return raiz;
}

// ---------- HL bloqueados: encabezado, gráficos de HL e isotanques por CD, estado de los isotanques e indicadores ----------

function tableroHl(): HTMLElement {
  const idsHl = ids(SERIES.hl);
  const totalHl = totalDe(idsHl);
  const llenos = totalDe(['isotanques_llenos']);
  const vacios = totalDe(['isotanques_vacios']);
  const isotanques = llenos + vacios;
  const necesidad = totalDe(['necesidad_isotanques']);
  const raiz = crear('div', 'fm-hl');

  // Encabezado: título con la barra roja, la fecha del corte y Actualizar.
  const cabeza = crear('div', 'fm-hl-cabeza');
  const titulos = crear('div');
  titulos.append(crear('h3', undefined, 'Inventario de HL'), crear('p', undefined, 'Resumen general de los bloqueados y pendientes por verter'));
  const acciones = crear('div', 'fm-hl-acciones');
  const [anio, mes, dia] = (corte.value || hoyIso()).split('-');
  const actualizar = crear('button', 'pv-btn pv-btn-primary fm-hl-actualizar');
  actualizar.type = 'button';
  actualizar.append(icono(TRAZOS_TABLERO.actualizar, 'pv-ico'), 'Actualizar');
  actualizar.addEventListener('click', () => { void cargarRespuestas(); });
  acciones.append(botonFecha('fm-hl-fecha', `${dia}/${mes}/${anio}`), actualizar);
  cabeza.append(titulos, acciones);

  // Izquierda: los dos gráficos por CD, uno debajo del otro.
  const izquierda = crear('div', 'fm-hl-col');
  const tarjetaHl = crear('div', 'fm-tb-card');
  tarjetaHl.append(grafico('HL por verter por CD', 'Hectolitros pendientes por verter en cada CD', SERIES.hl,
    { icono: TRAZOS_TABLERO.columnas, recortar: true, paginar: true, enfasis: { mayor: 'CD con más HL por verter', resto: 'Demás CD' } }));
  const tarjetaIso = crear('div', 'fm-tb-card');
  tarjetaIso.append(grafico('Isotanques por CD', 'Unidades llenas y vacías en cada CD', SERIES.isotanques, { icono: TRAZOS_TABLERO.isotanque, recortar: true, paginar: true }));
  izquierda.append(tarjetaHl, tarjetaIso);
  const nota = notaFaltan('no aparece en los gráficos', 'no aparecen en los gráficos');
  if (nota) izquierda.append(nota);

  // Derecha: estado de los isotanques (dona) e indicadores clave en cuadros.
  const lado = crear('div', 'fm-hl-col fm-hl-lado');
  const estado = crear('section', 'fm-tb-card fm-hl-estado');
  const cabezaEstado = crear('div', 'fm-tb-card-cabeza');
  cabezaEstado.append(cuadroIcono(TRAZOS_TABLERO.torta), crear('h4', undefined, 'Estado de los isotanques'));
  const leyenda = crear('ul', 'fm-hl-leyenda');
  leyenda.append(...SERIES.isotanques.map((s, j) => {
    const valor = j === 0 ? llenos : vacios;
    const item = crear('li');
    const muestra = crear('i', 'fm-muestra');
    muestra.style.setProperty('--c', `var(--serie-${j + 1})`);
    item.append(muestra, crear('span', undefined, s.nombre), crear('b', undefined, `${cifra(valor)} (${porcentaje(valor, isotanques)})`));
    return item;
  }));
  const totalIso = crear('li', 'fm-hl-leyenda-total');
  totalIso.append(crear('span', undefined, 'Total de isotanques'), crear('b', undefined, cifra(isotanques)));
  leyenda.append(totalIso);
  const cuerpoEstado = crear('div', 'fm-hl-estado-cuerpo');
  cuerpoEstado.append(dona(SERIES.isotanques, [llenos, vacios], isotanques, { valor: porcentaje(llenos, isotanques), texto: 'Llenos' }), leyenda);
  estado.append(cabezaEstado, cuerpoEstado);

  const indicadores = crear('section', 'fm-tb-card fm-hl-indicadores');
  const cabezaInd = crear('div', 'fm-tb-card-cabeza');
  cabezaInd.append(cuadroIcono(TRAZOS_TABLERO.tendencia), crear('h4', undefined, 'Indicadores clave'));
  const cuadros = crear('ul', 'fm-hl-cuadros');
  const cuadro = (clase: string, trazos: string, valor: string, etiqueta: string, detalle?: string) => {
    const li = crear('li', `fm-hl-cuadro ${clase}`);
    const arriba = crear('span', 'fm-hl-cuadro-arriba');
    arriba.append(cuadroIcono(trazos, 'fm-tb-circulo'), crear('b', undefined, valor));
    li.append(arriba, crear('small', undefined, etiqueta));
    if (detalle) li.append(crear('em', undefined, detalle));
    return li;
  };
  const variacion = variacionDiaAnterior(idsHl);
  cuadros.append(
    cuadro('morado', TRAZOS_TABLERO.columnas, variacion === null ? 'Sin dato' : textoCambio(variacion), 'HL por verter vs. día anterior', variacion === null ? 'No hay corte anterior para comparar' : undefined),
    cuadro('azul', TRAZOS_TABLERO.isotanque, cifra(necesidad), 'Necesidad de isotanques', `Más: ${cdConMas(['necesidad_isotanques'])}`),
    cuadro('verde', TRAZOS_TABLERO.bien, porcentaje(ultimos.size, TOTAL_CDS), 'Reporte de CD', `${ultimos.size} de ${TOTAL_CDS} CD reportaron`),
    cuadro('ambar', TRAZOS_TABLERO.promedio, cifraCorta(ultimos.size ? totalHl / ultimos.size : 0), 'HL por verter en promedio por CD', `Más: ${cdConMas(idsHl)}`),
  );
  indicadores.append(cabezaInd, cuadros);
  lado.append(estado, indicadores);

  const cuerpo = crear('div', 'fm-hl-cuerpo');
  cuerpo.append(izquierda, lado);
  raiz.append(cabeza, cuerpo);
  return raiz;
}

/** Panel de la pestaña elegida. */
function pintarPanel() {
  const i = PARTES.findIndex(p => p.clave === pestana);
  const configuracion = TABLEROS[pestana];
  if (configuracion) { resPanel.replaceChildren(tablero(configuracion, i, pestana)); return; }
  if (pestana === 'hl') { resPanel.replaceChildren(tableroHl()); return; }
  // Centro De Distribución: mismo encabezado y mismo panel que esa parte en el formulario.
  const parte = PARTES[i];
  const titulo = crear('h3', 'fm-res-titulo');
  titulo.append(crear('span', 'fm-parte-de', `Parte ${i + 1} de ${PARTES.length}`), formulario.secciones[i]?.titulo ?? '');
  const panel = crear('div', 'fm-panel-parte fm-res-caja');
  const circulo = crear('span', 'fm-parte-icono');
  circulo.append(icono(parte.icono, 'fm-parte-svg'));
  panel.append(circulo, contenidoCd(), ilustracion(parte.clave, panel));
  resPanel.replaceChildren(titulo, panel);
}

// Tabla por CD clasificada con las mismas partes del formulario (sin la del CD, que es la fila).
interface Columna { nombre: string; ids: string[]; total?: boolean }
const GRUPOS_TABLA = formulario.secciones.flatMap((s, i) => s.preguntas.some(p => p.id === 'cd') ? [] : [{
  titulo: s.titulo,
  icono: PARTES[i]?.icono ?? '',
  columnas: [
    ...s.preguntas.map((p): Columna => ({ nombre: nombreCorto(p), ids: [p.id] })),
    ...(s.sumable ? [{ nombre: 'Total', ids: s.preguntas.map(p => p.id), total: true } satisfies Columna] : []),
  ],
}]);
const claseColumna = (c: Columna, posicion: number) => ['num', c.total ? 'total' : '', posicion === 0 ? 'inicio' : ''].filter(Boolean).join(' ');

/** Celda de una cantidad; las que nadie llenó llevan una raya para que no parezcan un error. */
function celdaValor(clase: string | undefined, texto: string): HTMLTableCellElement {
  return crear('td', texto ? clase : `${clase ?? ''} vacia`.trim(), texto || '—');
}

/** Encabezado de un grupo de columnas: el ícono de la parte y su título. */
function encabezadoGrupo(titulo: string, trazos: string, columnas: number): HTMLTableCellElement {
  const th = Object.assign(crear('th', 'fm-grupo inicio'), { scope: 'colgroup', colSpan: columnas });
  if (trazos) th.append(icono(trazos, 'fm-ico'));
  th.append(titulo);
  return th;
}

function armarEncabezadoCd() {
  const grupos = crear('tr');
  const detalle = crear('tr');
  grupos.append(
    Object.assign(crear('th', 'fija', 'CD'), { scope: 'col', rowSpan: 2 }),
    Object.assign(crear('th', undefined, 'Último reporte'), { scope: 'col', rowSpan: 2 }),
  );
  for (const g of GRUPOS_TABLA) {
    grupos.append(encabezadoGrupo(g.titulo, g.icono, g.columnas.length));
    detalle.append(...g.columnas.map((c, i) => Object.assign(crear('th', claseColumna(c, i), c.nombre), { scope: 'col' })));
  }
  tablaCd.tHead!.replaceChildren(grupos, detalle);
}

/** Una fila por CD con reporte y el total regional. Los CD sin reporte van en una sola nota, no en filas vacías. */
function pintarTablaCd() {
  const columnas = GRUPOS_TABLA.flatMap(g => g.columnas.map((c, i) => ({ ...c, clase: claseColumna(c, i) })));
  tablaCd.tBodies[0].replaceChildren(...cdsConReporte().map(cd => {
    const r = ultimos.get(cd)!;
    const fila = crear('tr');
    const reporte = crear('td', 'fm-celda-reporte');
    reporte.append(crear('span', undefined, cuando(r.creado_en)), crear('small', undefined, r.usuario_nombre));
    fila.append(
      Object.assign(crear('th', 'fija cd', cd), { scope: 'row' }),
      reporte,
      ...columnas.map(c => celdaValor(c.clase, c.ids.length === 1 ? textoRespuesta(r.respuestas[c.ids[0]]) : cifra(suma(r, c.ids)))),
    );
    return fila;
  }));
  const pie = crear('tr');
  pie.append(
    Object.assign(crear('th', 'fija cd', 'Total regional'), { scope: 'row' }),
    crear('td', undefined, `${ultimos.size} de ${TOTAL_CDS} CD`),
    ...columnas.map(c => crear('td', c.clase, cifra(totalDe(c.ids)))),
  );
  tablaCd.tFoot!.replaceChildren(pie);
  const nota = notaFaltan('no aparece en la tabla', 'no aparecen en la tabla');
  resFaltan.replaceChildren(...(nota ? [nota] : []));
}

/** Sin reportes no hay nada que resumir: se explica por qué y se ofrece el siguiente paso. */
function pintarVacio(conFechaAnterior: boolean) {
  porId('fmResVacioTitulo').textContent = conFechaAnterior ? 'Ningún CD tenía reportes en esa fecha' : 'Aún no hay reportes';
  porId('fmResVacioTexto').textContent = conFechaAnterior
    ? 'Elige una fecha más reciente o vuelve al inventario de hoy.'
    : 'Cuando los centros de distribución llenen el formulario, aquí verás su inventario.';
  resVacioAccion.textContent = conFechaAnterior ? 'Ver inventario de hoy' : 'Llenar formulario';
  resVacioAccion.dataset.accion = conFechaAnterior ? 'hoy' : 'llenar';
}

resVacioAccion.addEventListener('click', () => {
  if (resVacioAccion.dataset.accion === 'hoy') { corte.value = hoyIso(); pintarResumen(); }
  else document.querySelector<HTMLButtonElement>('button[data-view="llenar"]')?.click();
});

function pintarResumen() {
  if (!registros) return;
  const hasta = fechaCorte();
  ultimos = ultimoPorCd(registros, hasta);
  ocultarTooltip();
  const hayReportes = ultimos.size > 0;
  resCuerpo.hidden = !hayReportes;
  resVacio.hidden = hayReportes;
  if (hayReportes) { pintarPestanas(); pintarPanel(); pintarTablaCd(); }
  else pintarVacio(!!hasta);
  const masAntigua = registros.at(-1);
  mostrarEstado(estadoResumen, hayReportes && truncado && hasta && masAntigua && hasta.getTime() <= Date.parse(masAntigua.creado_en)
    ? 'Solo se cargaron las respuestas más recientes; para esta fecha el resumen puede estar incompleto.' : '');
}

corte.max = hoyIso();
corte.value = hoyIso();
corte.addEventListener('change', pintarResumen);
porId('fmActualizarResumen').addEventListener('click', () => { void cargarRespuestas(); });

// ---------- Tabla de respuestas, clasificada por las partes del formulario ----------

const claseRespuesta = (p: Pregunta) =>
  [p.tipo === 'numero' ? 'num' : p.id === 'cd' ? 'cd' : '', inicioDeParte.has(p.id) ? 'inicio' : ''].filter(Boolean).join(' ') || undefined;
const columnasRespuestas: { clase?: string; valor: (r: Registro) => string }[] = [
  { clase: 'fija', valor: r => formatoFecha.format(new Date(r.creado_en)) },
  { valor: r => r.usuario_nombre },
  ...preguntas.map(p => ({ clase: claseRespuesta(p), valor: (r: Registro) => textoRespuesta(r.respuestas[p.id]) })),
];
const sinTildes = (texto: string) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const textoBusqueda = new WeakMap<Registro, string>();

function filtrados(): Registro[] {
  const consulta = sinTildes(buscar.value.trim());
  if (!registros || !consulta) return registros ?? [];
  return registros.filter(r => {
    let texto = textoBusqueda.get(r);
    if (texto === undefined) { texto = sinTildes(columnasRespuestas.map(c => c.valor(r)).join(' ')); textoBusqueda.set(r, texto); }
    return texto.includes(consulta);
  });
}

function armarEncabezado() {
  const grupos = crear('tr');
  const detalle = crear('tr');
  const fija = (texto: string, clase?: string) => Object.assign(crear('th', clase, texto), { scope: 'col', rowSpan: 2 });
  grupos.append(fija('Fecha de registro', 'fija'), fija('Registrado por'));
  formulario.secciones.forEach((seccion, i) => {
    // Una parte de una sola pregunta (el CD) no necesita grupo: ocupa las dos filas del encabezado.
    if (seccion.preguntas.length === 1) { const p = seccion.preguntas[0]; grupos.append(fija(nombreCorto(p), claseRespuesta(p))); return; }
    grupos.append(encabezadoGrupo(seccion.titulo, PARTES[i]?.icono ?? '', seccion.preguntas.length));
    detalle.append(...seccion.preguntas.map(p => Object.assign(crear('th', claseRespuesta(p), nombreCorto(p)), { scope: 'col', title: p.titulo })));
  });
  grupos.append(fija('Acciones', 'acciones'));
  tabla.tHead!.replaceChildren(grupos, detalle);
}

const TRAZOS_ACCION = {
  editar: '<path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m14 6 4 4"/>',
  eliminar: '<path d="M4 7h16M9.5 7V4.5h5V7M6.2 7l.9 12.5h9.8L17.8 7M10 11v5M14 11v5"/>',
} as const;
/** CD, fecha y autor de un reporte, para títulos y mensajes. */
const cdDe = (r: Registro) => textoRespuesta(r.respuestas.cd) || 'sin CD';
const describir = (r: Registro) => `${cdDe(r)} · ${formatoFecha.format(new Date(r.creado_en))} · ${r.usuario_nombre}`;

/** Botones Editar y Eliminar de una fila (cualquier usuario puede usarlos). */
function celdaAcciones(r: Registro): HTMLTableCellElement {
  const celda = crear('td', 'acciones');
  const boton = (clase: 'editar' | 'eliminar', texto: string, accion: () => void) => {
    const b = crear('button', `fm-accion ${clase}`);
    b.type = 'button';
    b.setAttribute('aria-label', `${texto} el reporte de ${describir(r)}`);
    b.append(icono(TRAZOS_ACCION[clase], 'fm-ico'), texto);
    b.addEventListener('click', accion);
    return b;
  };
  celda.append(boton('editar', 'Editar', () => abrirEdicion(r)), boton('eliminar', 'Eliminar', () => abrirEliminacion(r)));
  return celda;
}

function pintarTabla() {
  if (!registros) return;
  const lista = filtrados();
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  pagina = Math.min(pagina, paginas - 1);
  const visibles = lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  tabla.tBodies[0].replaceChildren(...visibles.map(r => {
    const fila = crear('tr');
    fila.append(...columnasRespuestas.map(c => celdaValor(c.clase, c.valor(r))), celdaAcciones(r));
    return fila;
  }));
  const total = registros.length;
  resumen.textContent = total === 0 ? 'Aún no hay respuestas registradas.'
    : `${lista.length === total ? total.toLocaleString('es-CO') : `${lista.length.toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')}`} ${total === 1 ? 'respuesta' : 'respuestas'}, de la más reciente a la más antigua.`
      + (truncado ? ' Se muestran solo las más recientes.' : '');
  mostrarEstado(estadoTabla, total && !lista.length ? 'Ninguna respuesta coincide con la búsqueda.' : '');
  textoPagina.textContent = `Página ${pagina + 1} de ${paginas}`;
  anterior.disabled = pagina === 0;
  siguiente.disabled = pagina >= paginas - 1;
}

buscar.addEventListener('input', () => { pagina = 0; pintarTabla(); });
anterior.addEventListener('click', () => { pagina -= 1; pintarTabla(); });
siguiente.addEventListener('click', () => { pagina += 1; pintarTabla(); });
porId('fmActualizar').addEventListener('click', () => { void cargarRespuestas(); });

// ---------- Editar y eliminar una respuesta ----------

const dialogoEditar = porId<HTMLDialogElement>('fmEditar');
const formEditar = porId<HTMLFormElement>('fmEditarForm');
const camposEditar = porId('fmEditarCampos');
const estadoEditar = porId('fmEditarEstado');
const botonGuardarEdicion = porId<HTMLButtonElement>('fmEditarGuardar');
const dialogoEliminar = porId<HTMLDialogElement>('fmEliminar');
const estadoEliminar = porId('fmEliminarEstado');
const botonConfirmarEliminar = porId<HTMLButtonElement>('fmEliminarConfirmar');
let enEdicion: Registro | null = null;
let porEliminar: Registro | null = null;

/** Mismas preguntas del formulario, agrupadas por parte, en la ventana de edición. */
function armarFormularioEdicion() {
  camposEditar.replaceChildren(...formulario.secciones.map((seccion, i) => {
    const bloque = crear('fieldset', 'fm-dialogo-seccion');
    const leyenda = crear('legend');
    leyenda.append(icono(PARTES[i]?.icono ?? '', 'fm-ico'), seccion.titulo);
    const grilla = crear('div', seccion.preguntas.length === 1 ? 'fm-grilla fm-grilla-unica' : 'fm-grilla');
    grilla.append(...seccion.preguntas.map(p => {
      const caja = crear('div', 'fm-pregunta');
      caja.dataset.pregunta = p.id;
      const etiqueta = crear('label', 'fm-enunciado', p.titulo);
      etiqueta.htmlFor = `fme-${p.id}`;
      if (p.obligatoria) etiqueta.append(crear('b', 'fm-req', '*'));
      const error = crear('p', 'fm-error');
      error.id = `fme-${p.id}-error`;
      const control = campo(p, 'fme');
      control.setAttribute('aria-describedby', error.id);
      caja.append(etiqueta, control, error);
      return caja;
    }));
    bloque.append(leyenda, grilla);
    return bloque;
  }));
}

function marcarErrorEdicion(p: Pregunta, mensaje: string) {
  const caja = camposEditar.querySelector<HTMLElement>(`[data-pregunta="${p.id}"]`);
  caja?.classList.toggle('fm-invalida', !!mensaje);
  const error = document.getElementById(`fme-${p.id}-error`);
  if (error) error.textContent = mensaje;
  caja?.querySelectorAll('input,select,textarea').forEach(c => c.setAttribute('aria-invalid', String(!!mensaje)));
}

/** Valida con las mismas reglas del formulario (y del servidor). */
function validarEdicion(p: Pregunta): boolean {
  try { normalizarValor(p, valorDe(p, formEditar)); marcarErrorEdicion(p, ''); return true; }
  catch (error) { marcarErrorEdicion(p, (error as Error).message); return false; }
}

function abrirEdicion(r: Registro) {
  enEdicion = r;
  for (const p of preguntas) {
    const valor = r.respuestas[p.id];
    // Los números se muestran con coma decimal, como se escriben en el formulario.
    const texto = valor === null || valor === undefined ? '' : typeof valor === 'number' ? String(valor).replace('.', ',') : String(valor);
    const elemento = formEditar.elements.namedItem(p.id);
    if (elemento instanceof RadioNodeList || elemento instanceof HTMLInputElement || elemento instanceof HTMLSelectElement || elemento instanceof HTMLTextAreaElement) elemento.value = texto;
    marcarErrorEdicion(p, '');
  }
  porId('fmEditarDetalle').textContent = `Reporte de ${describir(r)}. La fecha del reporte no cambia.`;
  mostrarEstado(estadoEditar, '');
  dialogoEditar.showModal();
  formEditar.querySelector<HTMLElement>('input,select,textarea')?.focus();
}

const cerrarEdicion = () => { dialogoEditar.close(); enEdicion = null; };
porId('fmEditarCancelar').addEventListener('click', cerrarEdicion);
porId('fmEditarCerrar').addEventListener('click', cerrarEdicion);
formEditar.addEventListener('change', evento => {
  const p = preguntas.find(q => q.id === (evento.target as HTMLInputElement).name);
  if (p) validarEdicion(p);
});

/** Respuesta de la API como mensaje para el usuario; si la sesión venció, vuelve al inicio de sesión. */
async function errorDeApi(respuesta: Response, porDefecto: string): Promise<string | null> {
  if (respuesta.status === 401) { location.replace('/'); return null; }
  const datos = await respuesta.json().catch(() => ({}));
  return datos.error || porDefecto;
}
const sinConexion = 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.';

formEditar.addEventListener('submit', async evento => {
  evento.preventDefault();
  const registro = enEdicion;
  if (!registro) return;
  const invalidas = preguntas.filter(p => !validarEdicion(p));
  if (invalidas.length) {
    mostrarEstado(estadoEditar, invalidas.length === 1 ? 'Revisa la pregunta marcada.' : `Revisa las ${invalidas.length} preguntas marcadas.`, 'error');
    camposEditar.querySelector<HTMLElement>('.fm-invalida :is(input,select,textarea)')?.focus();
    return;
  }
  botonGuardarEdicion.disabled = true;
  mostrarEstado(estadoEditar, 'Guardando cambios…');
  try {
    const respuesta = await fetch(`/api/formularios/respuestas/${encodeURIComponent(registro.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ respuestas: Object.fromEntries(preguntas.map(p => [p.id, valorDe(p, formEditar)])) }),
    });
    if (!respuesta.ok) {
      const mensaje = await errorDeApi(respuesta, 'No se pudo guardar el cambio. Inténtalo de nuevo.');
      if (mensaje) mostrarEstado(estadoEditar, mensaje, 'error');
      return;
    }
    const { respuesta: actualizada } = await respuesta.json() as { respuesta: Registro };
    if (registros) registros = registros.map(r => r.id === actualizada.id ? actualizada : r);
    pintarTodo();
    cerrarEdicion();
    porId('fmGuardadoTexto').textContent = `Los cambios del reporte de ${cdDe(actualizada)} quedaron guardados.`;
    guardado.showModal();
  } catch {
    mostrarEstado(estadoEditar, sinConexion, 'error');
  } finally {
    botonGuardarEdicion.disabled = false;
  }
});

function abrirEliminacion(r: Registro) {
  porEliminar = r;
  // Vuelve al estado de confirmación (la ventana pudo quedar en "Eliminado correctamente").
  dialogoEliminar.classList.remove('eliminado');
  porId('fmEliminarTitulo').textContent = '¿Eliminar este reporte?';
  porId('fmEliminarTexto').textContent = `Se eliminará el reporte de ${cdDe(r)} del ${formatoFecha.format(new Date(r.creado_en))}, registrado por ${r.usuario_nombre}. Esta acción no se puede deshacer.`;
  estadoEliminar.textContent = '';
  dialogoEliminar.showModal();
}

/** Tras eliminar: el reporte cae al bote, la tapa se cierra y aparece el chulo con el mensaje (animación en CSS, clase "eliminado"). */
function mostrarEliminado(registro: Registro) {
  porId('fmEliminarTitulo').textContent = 'Eliminado correctamente';
  porId('fmEliminarTexto').textContent = `El reporte de ${cdDe(registro)} del ${formatoFecha.format(new Date(registro.creado_en))} se eliminó.`;
  dialogoEliminar.classList.add('eliminado');
  porId('fmEliminarListo').focus();
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
    const respuesta = await fetch(`/api/formularios/respuestas/${encodeURIComponent(registro.id)}`, { method: 'DELETE' });
    // Si ya no existía, el resultado para el usuario es el mismo: deja de estar en la tabla.
    if (!respuesta.ok && respuesta.status !== 404) {
      const mensaje = await errorDeApi(respuesta, 'No se pudo eliminar el reporte. Inténtalo de nuevo.');
      if (mensaje) estadoEliminar.textContent = mensaje;
      return;
    }
    if (registros) registros = registros.filter(r => r.id !== registro.id);
    pintarTodo();
    porEliminar = null;
    mostrarEliminado(registro);
    mostrarEstado(estadoTabla, `Se eliminó el reporte de ${cdDe(registro)} del ${formatoFecha.format(new Date(registro.creado_en))}`, 'ok');
  } catch {
    estadoEliminar.textContent = sinConexion;
  } finally {
    botonConfirmarEliminar.disabled = false;
  }
});

// ---------- Carga de datos ----------

function pintarTodo() { pintarTabla(); pintarResumen(); }

function cargarRespuestas(): Promise<void> {
  cargando ??= (async () => {
    resumen.textContent = 'Consultando respuestas…';
    mostrarEstado(estadoTabla, '');
    if (!registros) mostrarEstado(estadoResumen, 'Consultando respuestas…');
    document.body.classList.add('fm-cargando');
    try {
      const respuesta = await fetch(`/api/formularios/respuestas?formulario=${encodeURIComponent(formulario.id)}`);
      if (respuesta.status === 401) { location.replace('/'); return; }
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.error || 'No se pudieron consultar las respuestas.');
      registros = datos.respuestas as Registro[];
      truncado = !!datos.truncado;
      pagina = 0;
      pintarTodo();
    } catch (error) {
      const mensaje = error instanceof TypeError ? 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.' : (error as Error).message;
      resumen.textContent = 'No se pudieron cargar las respuestas.';
      mostrarEstado(estadoTabla, mensaje, 'error');
      mostrarEstado(estadoResumen, mensaje, 'error');
    } finally {
      document.body.classList.remove('fm-cargando');
      cargando = null;
    }
  })();
  return cargando;
}

// ---------- Pestañas de la página ----------

const vistas = { llenar: porId('vistaLlenar'), resumen: porId('vistaResumen'), respuestas: porId('vistaRespuestas') };
for (const boton of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
  boton.addEventListener('click', () => {
    const vista = boton.dataset.view as keyof typeof vistas;
    document.body.dataset.vista = vista;
    for (const [nombre, seccion] of Object.entries(vistas)) seccion.hidden = nombre !== vista;
    for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
      b.classList.toggle('active', b === boton);
      if (b === boton) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    ocultarTooltip();
    if (vista !== 'llenar' && !registros) void cargarRespuestas();
  });
}

armarFormulario();
armarFormularioEdicion();
armarPestanas();
armarEncabezado();
armarEncabezadoCd();

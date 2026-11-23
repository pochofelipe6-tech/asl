// Módulo Control de inventarios: llena el formulario por partes, resume el inventario por CD y lista las respuestas.
// Tema, usuario y cierre de sesión los maneja modulos.ts, cargado en la misma página.
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
const resVacio = porId('fmResVacio');
const resVacioAccion = porId<HTMLButtonElement>('fmResVacioAccion');
const tooltip = porId('fmTooltip');

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

function campo(p: Pregunta): HTMLElement {
  const id = `fm-${p.id}`;
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

function valorDe(p: Pregunta): unknown {
  const elemento = form.elements.namedItem(p.id);
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
    reiniciar();
    mostrarEstado(estadoForm, 'Respuesta guardada. Puedes verla en las pestañas Resumen y Respuestas.', 'ok');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    mostrarEstado(estadoForm, error instanceof TypeError ? 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.' : (error as Error).message, 'error');
  } finally {
    botonEnviar.disabled = false;
  }
});

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
const NECESIDAD = ['necesidad_isotanques'] as const;
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

/** CD con el valor más alto, como "Cartagena KA · 1.099". */
function mayor(series: readonly string[]): string {
  let mejor = '';
  let maximo = 0;
  for (const cd of cdsConReporte()) {
    const valor = suma(ultimos.get(cd), series);
    if (valor > maximo) { maximo = valor; mejor = cd; }
  }
  return mejor ? `${mejor} · ${cifra(maximo)}` : '—';
}

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
/** Barras horizontales apiladas, una por CD con reporte, de mayor a menor. Los CD sin reporte no se dibujan. */
function grafico(titulo: string, detalle: string, series: Serie[]): HTMLElement {
  const figura = crear('figure', 'fm-grafico');
  const leyenda = crear('figcaption');
  leyenda.append(crear('h4', undefined, titulo), crear('p', undefined, detalle));
  figura.append(leyenda);
  if (series.length > 1) {
    const lista = crear('ul', 'fm-leyenda');
    lista.append(...series.map((s, i) => {
      const item = crear('li');
      const muestra = crear('i', 'fm-muestra');
      muestra.style.setProperty('--c', `var(--serie-${i + 1})`);
      item.append(muestra, s.nombre);
      return item;
    }));
    figura.append(lista);
  }

  const filas: FilaGrafico[] = cdsConReporte().map(cd => {
    const registro = ultimos.get(cd)!;
    const valores = series.map(s => numero(registro, s.id));
    return { cd, registro, valores, total: valores.reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.total - a.total || a.cd.localeCompare(b.cd));
  const maximo = Math.max(0, ...filas.map(f => f.total));

  const barras = crear('div', 'fm-barras');
  Object.assign(barras, { tabIndex: 0, role: 'listbox' });
  barras.setAttribute('aria-label', `${titulo}. Usa las flechas para recorrer los CD.`);
  let activa = -1;
  const elementos = filas.map((fila, i) => {
    const el = crear('div', 'fm-barra-fila');
    el.id = `fm-barra-${++consecutivo}`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', 'false');
    el.setAttribute('aria-label', `${fila.cd}: ${series.map((s, j) => `${s.nombre} ${cifra(fila.valores[j])}`).join(', ')}${series.length > 1 ? `, total ${cifra(fila.total)}` : ''}`);
    const pista = crear('span', 'fm-barra-pista');
    const barra = crear('span', 'fm-barra');
    barra.style.width = maximo > 0 ? `${(fila.total / maximo) * 100}%` : '0';
    fila.valores.forEach((valor, j) => {
      if (valor <= 0) return;
      const segmento = crear('span', 'fm-seg');
      segmento.style.flexGrow = String(valor);
      segmento.style.setProperty('--c', `var(--serie-${j + 1})`);
      barra.append(segmento);
    });
    pista.append(barra, crear('span', 'fm-barra-valor', cifra(fila.total)));
    el.append(crear('span', 'fm-barra-cd', fila.cd), pista);
    el.addEventListener('pointermove', evento => { anclaTooltip = null; mostrarTooltip(fila, series, evento.clientX, evento.clientY); });
    // Al hacer clic, el foco llega a la lista: que quede activo el CD tocado y no el primero.
    el.addEventListener('pointerdown', () => { activa = i; });
    return el;
  });
  barras.append(...elementos);
  barras.addEventListener('pointerleave', ocultarTooltip);

  // Teclado: la lista es una sola parada de tabulación y las flechas recorren los CD.
  const activar = (i: number) => {
    activa = Math.max(0, Math.min(i, elementos.length - 1));
    elementos.forEach((el, j) => { el.classList.toggle('activa', j === activa); el.setAttribute('aria-selected', String(j === activa)); });
    const el = elementos[activa];
    const fila = filas[activa];
    barras.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
    const ubicar = () => { const caja = el.getBoundingClientRect(); mostrarTooltip(fila, series, caja.left + 110, caja.bottom - 10); };
    ubicar();
    anclaTooltip = ubicar;
  };
  barras.addEventListener('focus', () => activar(Math.max(activa, 0)));
  barras.addEventListener('blur', () => { elementos.forEach(el => el.classList.remove('activa')); ocultarTooltip(); });
  barras.addEventListener('keydown', evento => {
    const teclas: Partial<Record<string, number>> = { ArrowDown: activa + 1, ArrowUp: activa - 1, Home: 0, End: elementos.length - 1 };
    const destino = teclas[evento.key];
    if (destino !== undefined) { evento.preventDefault(); activar(destino); }
    else if (evento.key === 'Escape') ocultarTooltip();
  });
  figura.append(barras);
  return figura;
}

// Pestañas del resumen: las mismas píldoras del formulario, cada una con el ícono de su parte y su cifra principal.
const pestanas = new Map<ClaveParte, { caja: HTMLElement; boton: HTMLButtonElement; valor: HTMLElement; unidad: HTMLElement }>();

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

/** Una cifra con su etiqueta. La principal de cada pestaña va en grande. */
function dato(etiqueta: string, valor: string, unidad: string, principal = false): HTMLDivElement {
  const caja = crear('div', 'fm-res-dato');
  const cifraEl = crear('strong', principal ? 'fm-res-heroe' : 'fm-res-medio', valor);
  cifraEl.append(crear('small', undefined, unidad));
  caja.append(crear('span', 'fm-res-etiqueta', etiqueta), cifraEl);
  return caja;
}

function extra(etiqueta: string, valor: string): HTMLParagraphElement {
  const linea = crear('p', 'fm-res-extra');
  linea.append(crear('span', undefined, etiqueta), crear('b', undefined, valor));
  return linea;
}

/** Reparto de un total entre sus series: franja fina y lista con cantidad y porcentaje. */
function desglose(series: Serie[]): HTMLElement[] {
  const valores = series.map(s => totalDe([s.id]));
  const total = valores.reduce((a, b) => a + b, 0);
  const franja = crear('div', 'fm-res-franja');
  franja.setAttribute('aria-hidden', 'true'); // la lista de abajo dice lo mismo con texto
  const lista = crear('ul', 'fm-res-desglose');
  series.forEach((s, i) => {
    const color = `var(--serie-${i + 1})`;
    if (valores[i] > 0) {
      const parte = crear('span');
      parte.style.flexGrow = String(valores[i]);
      parte.style.setProperty('--c', color);
      franja.append(parte);
    }
    const item = crear('li');
    const muestra = crear('i', 'fm-muestra');
    muestra.style.setProperty('--c', color);
    item.append(muestra, crear('span', undefined, s.nombre), crear('b', undefined, cifra(valores[i])), crear('em', undefined, porcentaje(valores[i], total)));
    lista.append(item);
  });
  return total > 0 ? [franja, lista] : [lista];
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

/** Totales a la izquierda y gráficos a la derecha. */
function dosColumnas(totales: HTMLElement[], graficosDeParte: HTMLElement[]): HTMLElement {
  const caja = crear('div', 'fm-res-contenido');
  const izquierda = crear('div', 'fm-res-totales');
  izquierda.append(...totales);
  const derecha = crear('div', 'fm-res-derecha');
  const rejilla = crear('div', 'fm-res-graficos');
  rejilla.append(...graficosDeParte);
  derecha.append(rejilla);
  const nota = notaFaltan('no aparece en el gráfico', 'no aparecen en el gráfico');
  if (nota) derecha.append(nota);
  caja.append(izquierda, derecha);
  return caja;
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

function contenidoEstibas(): HTMLElement {
  const total = totalDe(ids(SERIES.estibas));
  const principal = dato('Estibas en la regional', cifra(total), 'unidades', true);
  principal.append(...desglose(SERIES.estibas));
  const otros = crear('div', 'fm-res-dato');
  otros.append(extra('Promedio por CD con reporte', cifraCorta(total / ultimos.size)), extra('CD con más estibas', mayor(ids(SERIES.estibas))));
  return dosColumnas([principal, otros], [grafico('Estibas por CD', 'Unidades por tipo, de mayor a menor', SERIES.estibas)]);
}

function contenidoHl(): HTMLElement {
  const hl = dato('HL pendientes por verter', cifra(totalDe(ids(SERIES.hl))), 'HL', true);
  hl.append(extra('CD con más HL pendientes', mayor(ids(SERIES.hl))));
  const isotanques = dato('Isotanques', cifra(totalDe(ids(SERIES.isotanques))), 'unidades');
  isotanques.append(...desglose(SERIES.isotanques));
  const necesidad = dato('Necesidad de isotanques', cifra(totalDe(NECESIDAD)), 'unidades');
  necesidad.append(extra('CD que más pide', mayor(NECESIDAD)));
  return dosColumnas([hl, isotanques, necesidad], [
    grafico('HL pendientes por verter por CD', 'Hectolitros, de mayor a menor', SERIES.hl),
    grafico('Isotanques por CD', 'Unidades llenas y vacías, de mayor a menor', SERIES.isotanques),
  ]);
}

function contenidoCajas(): HTMLElement {
  const total = totalDe(ids(SERIES.cajas));
  const principal = dato('Cajas plásticas en la regional', cifra(total), 'unidades', true);
  principal.append(...desglose(SERIES.cajas));
  const otros = crear('div', 'fm-res-dato');
  otros.append(extra('Promedio por CD con reporte', cifraCorta(total / ultimos.size)), extra('CD con más cajas', mayor(ids(SERIES.cajas))));
  return dosColumnas([principal, otros], [grafico('Cajas plásticas por CD', 'Unidades por referencia, de mayor a menor', SERIES.cajas)]);
}

const CONTENIDOS: Record<ClaveParte, () => HTMLElement> = { cd: contenidoCd, estibas: contenidoEstibas, hl: contenidoHl, cajas: contenidoCajas };

/** Panel de la pestaña elegida: mismo encabezado y mismo panel que esa parte en el formulario. */
function pintarPanel() {
  const i = PARTES.findIndex(p => p.clave === pestana);
  const parte = PARTES[i];
  const titulo = crear('h3', 'fm-res-titulo');
  titulo.append(crear('span', 'fm-parte-de', `Parte ${i + 1} de ${PARTES.length}`), formulario.secciones[i]?.titulo ?? '');
  const panel = crear('div', 'fm-panel-parte fm-res-caja');
  const circulo = crear('span', 'fm-parte-icono');
  circulo.append(icono(parte.icono, 'fm-parte-svg'));
  panel.append(circulo, CONTENIDOS[pestana](), ilustracion(parte.clave, panel));
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
  tabla.tHead!.replaceChildren(grupos, detalle);
}

function pintarTabla() {
  if (!registros) return;
  const lista = filtrados();
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  pagina = Math.min(pagina, paginas - 1);
  const visibles = lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  tabla.tBodies[0].replaceChildren(...visibles.map(r => {
    const fila = crear('tr');
    fila.append(...columnasRespuestas.map(c => celdaValor(c.clase, c.valor(r))));
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
armarPestanas();
armarEncabezado();
armarEncabezadoCd();

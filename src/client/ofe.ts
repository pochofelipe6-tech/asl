// Módulo OFE: versión completa de la página "OFE" del Power BI "Seguimiento ATCT" (uso de los montacargas).
// Trae del servidor la última carga de Data FMS.xlsx (en columnas) y calcula TODO en el navegador con src/shared/ofe.ts
// (las reglas del Power BI viven allí; aquí solo se dibuja). Al cambiar un filtro se recalcula.
// Muestra 4 tarjetas, 5 gráficos en SVG propio (cada uno con "Ver tabla"), la dona de composición, la tabla por CD,
// el aviso de los montacargas que no están en la lista y la carga de archivos nuevos. Tema, usuario y salida: modulos.ts.
// La lista de montacargas (de ella salen el CD y la placa de cada registro) se puede completar y corregir desde la
// ventana "Montacargas": al guardar, las filas se recalculan con la lista nueva sin volver a descargar Data FMS.
// Mismo diseño y mismas piezas que Seguimiento T1 (t1.ts / t1.css); lo propio de OFE va en ofe.css.
import { porId } from './dom';
import { calcularOfe, claveChasis, filasFms, listaMontacargas, opcionesOfe, revisarMontacargas, CDS_FMS } from '../shared/ofe';
import type { CambioMontacargas, ColumnasFms, FilaFms, FiltrosOfe, MontacargasDeLista, ResultadoOfe } from '../shared/ofe';
import { diaDeIso, fechaDeDia, horasATexto, isoDeDia, DIAS_SEMANA, MESES } from '../shared/t1';
import { calcularWip, filasWip } from '../shared/wip';
import type { ColumnasWip, FilaWip, ResultadoWip } from '../shared/wip';
import type { RespuestaWorkerCargas } from './cargas-worker';

const SVG = 'http://www.w3.org/2000/svg';
const SIN_CONEXION = 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Formatos ----------

const cifra = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
const formato1 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formato2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hay = (n: number | null): n is number => n !== null && Number.isFinite(n);
/** Suma de horas con 1 decimal ("1.234,5"), o "—" si no hay dato. */
const horas1 = (n: number | null) => (hay(n) ? formato1.format(n) : '—');
/** Promedio de horas con 2 decimales ("2,38"), o "—". */
const horas2 = (n: number | null) => (hay(n) ? formato2.format(n) : '—');
/** "1.234,5 h" (sin la h si no hay dato). */
const conH = (texto: string) => (texto === '—' ? texto : `${texto} h`);
/** Horas y minutos ("1:23") solo para cifras de menos de un día; en sumas grandes no ayudan. */
const horasMinutos = (n: number) => (Math.abs(n) < 24 ? horasATexto(n) : '');
/** "1,38 h · 1:23" (o "236,50 h") para la ventanita. */
const horasLargo = (n: number | null) => (hay(n) ? `${formato2.format(n)} h${horasMinutos(n) ? ` · ${horasMinutos(n)}` : ''}` : 'Sin datos');
/** Fracción como porcentaje con 1 decimal ("18,0 %"). */
const porcentaje = (n: number | null) => (hay(n) ? `${formato1.format(n * 100)} %` : '—');
const porcentajeLargo = (n: number | null) => (hay(n) ? `${formato2.format(n * 100)} %` : 'Sin datos');
const formatoFecha = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const fecha = (dia: number) => formatoFecha.format(fechaDeDia(dia));
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** "2 oct". */
const diaCorto = (dia: number) => { const f = fechaDeDia(dia); return `${f.getUTCDate()} ${MES_CORTO[f.getUTCMonth()]}`; };
/** "Jueves, 01/10/2026". */
const fechaLarga = (dia: number) => `${mayuscula(DIAS_SEMANA[fechaDeDia(dia).getUTCDay()])}, ${fecha(dia)}`;
/** "Octubre 2026" de "2026-10". */
const nombreMes = (mes: string) => `${mayuscula(MESES[Number(mes.slice(5, 7)) - 1])} ${mes.slice(0, 4)}`;
const plural = (n: number, uno: string, varios: string) => `${cifra(n)} ${n === 1 ? uno : varios}`;
const mesDeDia = (dia: number) => isoDeDia(dia).slice(0, 7);
/** Último día del mes "AAAA-MM" (día de Excel). */
function finDeMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number);
  return diaDeIso(`${mes}-01`) + new Date(Date.UTC(a, m, 0)).getUTCDate() - 1;
}
const formatoMomento = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
const porTexto = new Intl.Collator('es', { numeric: true }).compare;
/** Para buscar sin tildes ni mayúsculas. */
const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function crear<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}
function nodo<K extends keyof SVGElementTagNameMap>(etiqueta: K, atributos: Record<string, string | number>, texto?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) el.setAttribute(nombre, String(valor));
  if (texto !== undefined) el.textContent = texto;
  return el;
}
function icono(trazos: string): SVGSVGElement {
  const svg = nodo('svg', { viewBox: '0 0 24 24', class: 't1-ico', 'aria-hidden': 'true' });
  svg.append(nodo('path', { d: trazos }));
  return svg;
}

// ---------- Estado ----------

type Dimension = 'cds' | 'maquinas' | 'turnos';
type OpcionesOfe = ReturnType<typeof opcionesOfe>;
interface Filtro { desde: number; hasta: number; cds: string[]; maquinas: string[]; turnos: string[] }
interface Carga { archivo: string; filas: number; desde: string; hasta: string; usuario_nombre: string | null; creado_en: string }

/** Data FMS tal como llega del servidor: se guarda para recalcular las filas cuando cambia la lista de montacargas. */
let columnasFms: ColumnasFms | null = null;
let filas: FilaFms[] | null = null;
let opciones: OpcionesOfe | null = null;
let carga: Carga | null = null;
/** Montacargas agregados o corregidos desde la página, y la lista que resulta (la base con esos cambios). */
let cambios: CambioMontacargas[] = [];
let lista: MontacargasDeLista[] = listaMontacargas();
/** Si no se pudieron consultar los cambios, la página sigue con la lista base y lo avisa. */
let listaFallo = false;
/** CD de cada máquina (placa), para limitar la lista de máquinas a los CD elegidos. */
let cdDeMaquina = new Map<string, string>();
const filtro: Filtro = { desde: 0, hasta: 0, cds: [], maquinas: [], turnos: [] };
/** Mientras el usuario no toque las fechas, una carga nueva vuelve a poner el mes de la última fecha. */
let rangoPorDefecto = true;
let cargando: Promise<void> | null = null;

const anuncio = porId('ofeAnuncio');
const resumenTexto = porId('ofeResumen');
const tablero = porId('ofeTablero');
const campoDesde = porId<HTMLInputElement>('ofeDesde');
const campoHasta = porId<HTMLInputElement>('ofeHasta');
const campoMes = porId<HTMLSelectElement>('ofeMes');

/** Filtros para el motor; "sin" deja fuera una dimensión (el gráfico de esa dimensión muestra todas sus barras y resalta las elegidas). */
function paraMotor(sin?: Dimension): FiltrosOfe {
  return {
    desde: filtro.desde, hasta: filtro.hasta,
    cds: filtro.cds, maquinas: sin === 'maquinas' ? [] : filtro.maquinas, turnos: sin === 'turnos' ? [] : filtro.turnos,
  };
}
const memoria = new Map<string, ResultadoOfe>();
function calcular(f: FiltrosOfe): ResultadoOfe {
  const clave = JSON.stringify(f);
  let r = memoria.get(clave);
  if (!r) {
    r = calcularOfe(filas!, f);
    if (memoria.size > 16) memoria.delete(memoria.keys().next().value!);
    memoria.set(clave, r);
  }
  return r;
}

// ---------- Ventanita de detalle (puntero o teclado) ----------

const tip = porId('ofeTip');
interface FilaTip { nombre: string; valor: string; clase?: string; fuerte?: boolean }

function mostrarTip(titulo: string, filasTip: readonly FilaTip[], x: number, y: number, pista?: string) {
  const lista = crear('dl', 't1-tip-filas');
  for (const f of filasTip) {
    const dt = crear('dt', f.fuerte ? 't1-tip-total' : undefined);
    if (f.clase) dt.append(crear('i', `t1-tip-clave ${f.clase}`));
    dt.append(f.nombre);
    lista.append(dt, crear('dd', f.fuerte ? 't1-tip-total' : undefined, f.valor));
  }
  tip.replaceChildren(crear('strong', 't1-tip-titulo', titulo), lista);
  if (pista) tip.append(crear('p', 't1-tip-pista', pista));
  tip.hidden = false;
  const caja = tip.getBoundingClientRect();
  const izquierda = Math.min(Math.max(8, x - caja.width / 2), innerWidth - caja.width - 8);
  const arriba = y - caja.height - 14 < 8 ? y + 18 : y - caja.height - 14;
  tip.style.left = `${izquierda}px`;
  tip.style.top = `${arriba}px`;
}
const ocultarTip = () => { tip.hidden = true; };
addEventListener('scroll', ocultarTip, { passive: true });

// ---------- Gráficos (líneas, barras y columnas) ----------

/** Series (colores validados con el skill dataviz, claro y oscuro: ver ofe.css). */
interface Serie { nombre: string; corto: string; clase: string }
const RALENTI: Serie = { nombre: 'Horas ralentí', corto: 'Ralentí', clase: 'ofe-c-ral' };
const CARGA: Serie = { nombre: 'Horas carga', corto: 'Carga', clase: 'ofe-c-car' };
const MOVIMIENTO: Serie = { nombre: 'Horas movimiento', corto: 'Movimiento', clase: 'ofe-c-mov' };
const P_ENCENDIDO: Serie = { nombre: '% Encendido', corto: 'Encendido', clase: 'ofe-c-enc' };
const P_MOVIMIENTO: Serie = { nombre: '% Movimiento', corto: 'Movimiento', clase: 'ofe-c-mov' };
const P_CARGA: Serie = { nombre: '% Carga', corto: 'Carga', clase: 'ofe-c-car' };
const OFE: Serie = { nombre: 'OFE', corto: 'OFE', clase: 'ofe-c-ofe' };
/** Colores del Power BI "Seguimiento ATCT" (tema por defecto): en cada gráfico, la 1.ª serie va en azul, la 2.ª en azul
 *  oscuro y la 3.ª en naranja, en el mismo orden que allá (por eso el ralentí cambia de color de un gráfico a otro). */
const enPosicion = (serie: Serie, n: 1 | 2 | 3): Serie => ({ ...serie, clase: `ofe-p${n}` });

/** Cómo se escriben las cifras de un gráfico: horas (suma o promedio) o porcentaje. */
interface Medida { corta: (n: number | null) => string; larga: (n: number | null) => string; eje: (n: number) => string; horas: boolean }
const cifraEje = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const SUMA_HORAS: Medida = { corta: horas1, larga: horasLargo, eje: cifraEje, horas: true };
const PROMEDIO_HORAS: Medida = { corta: horas2, larga: horasLargo, eje: cifraEje, horas: true };
const PORCENTAJE: Medida = { corta: porcentaje, larga: porcentajeLargo, eje: n => `${cifraEje(Number((n * 100).toFixed(4)))} %`, horas: false };

interface Categoria {
  clave: string; etiqueta: string; titulo: string; valores: (number | null)[];
  /** Texto secundario junto a la etiqueta (el CD de cada máquina). */
  detalle?: string;
  /** Filas de más para la ventanita (p. ej., el OFE en el gráfico de ralentí). */
  extra?: FilaTip[];
  /** Posición en el eje (días de Excel) para las líneas por fecha. */
  x?: number;
  /** Color propio de esta columna (semáforo), en vez del de la serie. */
  clase?: string;
}
interface Grafico {
  caja: HTMLElement; subtitulo: HTMLElement | null; nombre: string; forma: 'linea' | 'barras' | 'columnas';
  series: Serie[]; medida: Medida; categorias: Categoria[]; encabezado: string; encabezadoDetalle: string;
  /** Si tiene dimensión, un clic en una barra filtra la página por ella. */
  dimension: Dimension | null; seleccion: Set<string>;
  /** Lista larga: se ve por páginas de POR_PAGINA barras y se pasa de una a otra con las flechas (sin barras de desplazamiento). */
  paginar: boolean; pagina: number;
  /** Si va en la misma fila que este elemento (la tabla por CD), el gráfico toma su alto: la tarjeta no queda medio vacía. */
  igualarA: HTMLElement | null;
  vacio: string; enTabla: boolean; ancho: number; foco: number;
  /** Líneas de meta (verdes punteadas, como la línea constante del Power BI). */
  metas: { nombre: string; valor: number }[];
  /** Convenciones de colores por valor (semáforo), si el gráfico las usa. */
  convenciones: { clase: string; nombre: string }[];
}
function nuevoGrafico(caja: string, subtitulo: string | null, nombre: string, forma: Grafico['forma'], series: Serie[], medida: Medida, encabezado: string, extra: Partial<Grafico> = {}): Grafico {
  return {
    caja: porId(caja), subtitulo: subtitulo ? porId(subtitulo) : null, nombre, forma, series, medida, categorias: [], encabezado, encabezadoDetalle: '',
    dimension: null, seleccion: new Set(), paginar: false, pagina: 0, igualarA: null, vacio: 'Sin registros con estos filtros.', enTabla: false, ancho: 0, foco: 0, metas: [], convenciones: [], ...extra,
  };
}
const graficos: Record<string, Grafico> = {
  turno: nuevoGrafico('ofeGTurno', null, 'Seguimiento por turno', 'columnas', [enPosicion(RALENTI, 1), enPosicion(CARGA, 2), enPosicion(MOVIMIENTO, 3)], PROMEDIO_HORAS, 'Turno', { dimension: 'turnos' }),
  dia: nuevoGrafico('ofeGDia', 'ofeGDiaS', '% Encendido, movimiento y carga por día', 'linea', [enPosicion(P_ENCENDIDO, 1), enPosicion(P_MOVIMIENTO, 2), enPosicion(P_CARGA, 3)], PORCENTAJE, 'Fecha'),
  maquinaRalenti: nuevoGrafico('ofeGMaqRal', 'ofeGMaqRalS', 'Tiempo ralentí por máquina', 'barras', [enPosicion(RALENTI, 1)], SUMA_HORAS, 'Máquina', { dimension: 'maquinas', paginar: true, encabezadoDetalle: 'CD', metas: [{ nombre: 'Meta 1 h', valor: 1 }] }),
  maquinaOfe: nuevoGrafico('ofeGMaqOfe', 'ofeGMaqOfeS', '% OFE por máquina', 'barras', [enPosicion(OFE, 1)], PORCENTAJE, 'Máquina', { dimension: 'maquinas', paginar: true, encabezadoDetalle: 'CD' }),
  gerencia: nuevoGrafico('ofeGGer', 'ofeGGerS', 'Tiempo ralentí por gerencia', 'columnas', [enPosicion(RALENTI, 1)], SUMA_HORAS, 'Gerencia', { igualarA: porId('ofeTCd') }),
};

/** Marcas "redondas" del eje (0; 0,5; 1; 1,5…): unas 4 o 5. */
function marcasEje(max: number): number[] {
  const tope = Math.max(max, 0.01);
  const bruto = tope / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map(f => f * potencia).find(p => p >= bruto) ?? 10 * potencia;
  const marcas = [0];
  while (marcas[marcas.length - 1] < tope - 1e-9) marcas.push(Number((marcas[marcas.length - 1] + paso).toFixed(6)));
  return marcas;
}
/** Ancho aproximado de un texto (Segoe UI, seminegrita). */
const anchoTexto = (texto: string, tamano = 11.5) => texto.length * tamano * 0.585;
const hayDatos = (g: Grafico) => g.categorias.some(c => c.valores.some(v => v !== null));
const sinSerie = (g: Grafico, k: number) => g.categorias.every(c => c.valores[k] === null);
/** "% OFE" se lee como porcentaje; las horas llevan la palabra. */
const valorDicho = (g: Grafico, v: number | null) => (v === null ? 'sin datos' : g.medida.horas ? `${g.medida.corta(v)} horas` : g.medida.corta(v));

function filasTip(g: Grafico, c: Categoria): FilaTip[] {
  const filasDe: FilaTip[] = g.series.map((s, k) => ({ nombre: s.nombre, valor: g.medida.larga(c.valores[k]), clase: c.clase ?? s.clase, fuerte: g.series.length === 1 }));
  return c.extra ? [...filasDe, ...c.extra] : filasDe;
}
function textoCategoria(g: Grafico, c: Categoria): string {
  return `${c.titulo}: ${g.series.map((s, k) => `${s.nombre} ${valorDicho(g, c.valores[k])}`).join(', ')}`;
}
function pistaDe(g: Grafico, c: Categoria): string | undefined {
  if (!g.dimension) return undefined;
  return g.seleccion.has(c.clave) ? 'Clic para quitar este filtro' : 'Clic para filtrar toda la página';
}

function leyendaDe(g: Grafico): HTMLElement | null {
  if (g.series.length < 2 && !g.metas.length && !g.convenciones.length) return null;
  const lista = crear('ul', 't1-leyenda');
  lista.setAttribute('aria-label', 'Convenciones');
  for (const c of g.convenciones) {
    const li = crear('li');
    li.append(crear('i', `t1-muestra ${c.clase}`), c.nombre);
    lista.append(li);
  }
  if (g.series.length > 1) {
    for (const [k, s] of g.series.entries()) {
      const li = crear('li');
      li.append(crear('i', `t1-muestra ${g.forma === 'linea' ? 't1-muestra-linea ' : ''}${s.clase}`), s.nombre);
      if (sinSerie(g, k)) li.append(crear('span', 't1-leyenda-nota', '· sin datos'));
      lista.append(li);
    }
  }
  for (const m of g.metas) {
    const li = crear('li');
    li.append(crear('i', 't1-muestra t1-muestra-meta ofe-muestra-meta'), m.nombre);
    lista.append(li);
  }
  return lista;
}

/** La tabla con las mismas cifras del gráfico (botón "Ver tabla"). */
function tablaDe(g: Grafico): HTMLElement {
  const caja = crear('div', 't1-tabla-caja t1-tabla-grafico');
  caja.setAttribute('role', 'region');
  caja.tabIndex = 0;
  caja.setAttribute('aria-label', `Tabla: ${g.nombre}`);
  const tabla = crear('table', 't1-tabla');
  const cabeza = tabla.createTHead().insertRow();
  const conDetalle = !!g.encabezadoDetalle && g.categorias.some(c => c.detalle);
  [g.encabezado, ...(conDetalle ? [g.encabezadoDetalle] : []), ...g.series.map(s => (g.medida.horas ? `${s.nombre} (h)` : s.nombre))].forEach((texto, i) => {
    const th = crear('th', i > (conDetalle ? 1 : 0) ? 'num' : undefined, texto);
    th.scope = 'col';
    cabeza.append(th);
  });
  const cuerpo = tabla.createTBody();
  for (const c of g.categorias) {
    const fila = cuerpo.insertRow();
    const th = crear('th', undefined, c.etiqueta === c.titulo || conDetalle ? c.etiqueta : c.titulo);
    th.scope = 'row';
    fila.append(th);
    if (conDetalle) fila.append(crear('td', undefined, c.detalle ?? ''));
    for (const v of c.valores) {
      const td = crear('td', 'num', g.medida.corta(v));
      if (v !== null && g.medida.horas && horasMinutos(v)) td.append(crear('small', undefined, horasMinutos(v)));
      fila.append(td);
    }
  }
  caja.append(tabla);
  return caja;
}

/** Teclado común: flechas para pasar de una marca a otra; Enter o espacio filtra (si el gráfico filtra). */
function conTeclado(g: Grafico, svg: SVGSVGElement, n: number, mostrar: (i: number) => void, limpiar: () => void) {
  const enfocar = (i: number) => {
    g.foco = Math.max(0, Math.min(n - 1, i));
    mostrar(g.foco);
    anuncio.textContent = textoCategoria(g, g.categorias[g.foco]);
  };
  svg.addEventListener('focus', () => enfocar(Math.min(g.foco, n - 1)));
  svg.addEventListener('blur', () => { limpiar(); ocultarTip(); });
  svg.addEventListener('keydown', evento => {
    const pasos: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };
    if (evento.key in pasos) { evento.preventDefault(); enfocar(g.foco + pasos[evento.key]); }
    else if (evento.key === 'Home') { evento.preventDefault(); enfocar(0); }
    else if (evento.key === 'End') { evento.preventDefault(); enfocar(n - 1); }
    else if (evento.key === 'Escape') ocultarTip();
    else if ((evento.key === 'Enter' || evento.key === ' ') && g.dimension) { evento.preventDefault(); alternar(g.dimension, g.categorias[g.foco].clave); }
  });
}
function etiquetaAccesible(g: Grafico, unidad: string, ayuda: string): string {
  const n = g.categorias.length;
  return `${g.nombre}${g.medida.horas ? ', en horas' : ''}. ${n === 1 ? `Un ${unidad}` : `${n} ${unidad}s`}. ${ayuda} ${g.categorias.slice(0, 16).map(c => textoCategoria(g, c)).join('. ')}`;
}
type Marca = SVGGElement & { mostrar?: () => void };

/** Barras horizontales (una por máquina). El valor va en la punta de cada barra; el CD, junto a la placa.
 *  "todas" es la lista completa cuando se dibuja una sola página: de ella salen la escala y los márgenes. */
function dibujarBarras(g: Grafico, ancho: number, todas: Categoria[] = g.categorias): SVGSVGElement {
  const n = g.categorias.length;
  // El tamaño de las filas y el alto salen de la lista completa: todas las páginas miden lo mismo y las flechas no saltan.
  const FILA = todas.length > 9 ? 20 : 30;
  const GROSOR = todas.length > 9 ? 13 : 18;
  const completo = (c: Categoria) => (c.detalle ? `${c.etiqueta} · ${c.detalle}` : c.etiqueta);
  // El CD junto a la placa solo si cabe (en celular queda en la ventanita).
  const conDetalle = Math.max(...todas.map(c => anchoTexto(completo(c), 12.5))) + 22 <= ancho * 0.42;
  const IZQUIERDA = Math.round(Math.min(ancho * 0.42, Math.max(...todas.map(c => anchoTexto(conDetalle ? completo(c) : c.etiqueta, 12.5))) + 22));
  const valores = g.categorias.map(c => c.valores[0]);
  const valoresTodas = todas.map(c => c.valores[0]);
  const DERECHA = Math.round(Math.max(40, ...valoresTodas.map(v => anchoTexto(g.medida.corta(v)))) + 12);
  const ARRIBA = 4;
  const alto = ARRIBA * 2 + Math.max(n, Math.min(POR_PAGINA, todas.length)) * FILA;
  // La escala llega al menos hasta la meta, para que siempre se vea.
  const tope = Math.max(0.0001, ...valoresTodas.map(v => v ?? 0), ...g.metas.map(m => m.valor));
  const largo = Math.max(40, ancho - IZQUIERDA - DERECHA);
  const filtra = !!g.dimension;
  const svg = nodo('svg', { width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}`, class: `t1-svg${filtra ? ' t1-filtra' : ''}${g.seleccion.size ? ' t1-con-seleccion' : ''}`, tabindex: 0, role: 'img' });
  const textoMetas = g.metas.map(m => ` ${m.nombre}.`).join('');
  svg.setAttribute('aria-label', etiquetaAccesible(g, 'barra', `Usa las flechas para leer cada una${filtra ? ' y Enter para filtrar la página' : ''}.${textoMetas}`));
  svg.append(nodo('line', { x1: IZQUIERDA, x2: IZQUIERDA, y1: 0, y2: alto, class: 't1-base' }));
  const marcas: Marca[] = [];
  g.categorias.forEach((c, i) => {
    const y0 = ARRIBA + i * FILA;
    const centro = y0 + FILA / 2;
    const elegida = g.seleccion.has(c.clave);
    const grupo: Marca = nodo('g', { class: `t1-marca${elegida ? ' t1-elegida' : ''}${g.seleccion.size && !elegida ? ' t1-atenuada' : ''}`, style: `--i:${Math.min(i, 24)}` });
    grupo.append(nodo('rect', { x: 0, y: y0 + 1, width: ancho, height: FILA - 2, rx: 6, class: 't1-zona' }));
    const etiqueta = nodo('text', { x: IZQUIERDA - 10, y: centro, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 't1-eje t1-eje-cat' }, c.etiqueta);
    if (conDetalle && c.detalle) etiqueta.append(nodo('tspan', { class: 'ofe-eje-detalle' }, ` · ${c.detalle}`));
    grupo.append(etiqueta);
    const v = valores[i];
    const w = v === null ? 0 : (v / tope) * largo;
    const top = centro - GROSOR / 2;
    if (w > 0) {
      const barra = nodo('g', { class: 't1-barra' });
      const r = Math.min(4, GROSOR / 2, w);
      barra.append(nodo('path', { class: `t1-parte ${g.series[0].clase}`, d: `M${IZQUIERDA} ${top}H${IZQUIERDA + w - r}a${r} ${r} 0 0 1 ${r} ${r}V${top + GROSOR - r}a${r} ${r} 0 0 1 ${-r} ${r}H${IZQUIERDA}z` }));
      grupo.append(barra);
    }
    grupo.append(nodo('text', { x: v === null ? IZQUIERDA + 8 : IZQUIERDA + w + 7, y: centro, 'dominant-baseline': 'central', class: `t1-cifra${v === null ? ' t1-cifra-nula' : ''}` }, g.medida.corta(v)));
    const mostrar = (cx: number, cy: number) => {
      svg.classList.add('t1-enfoque');
      marcas.forEach((m, k) => m.classList.toggle('t1-activa', k === i));
      mostrarTip(c.titulo, filasTip(g, c), cx, cy, pistaDe(g, c));
    };
    grupo.addEventListener('pointermove', evento => { g.foco = i; mostrar(evento.clientX, evento.clientY); });
    grupo.addEventListener('pointerleave', () => { svg.classList.remove('t1-enfoque'); grupo.classList.remove('t1-activa'); ocultarTip(); });
    if (filtra) grupo.addEventListener('click', () => alternar(g.dimension!, c.clave));
    grupo.mostrar = () => {
      const caja = svg.getBoundingClientRect();
      mostrar(caja.left + IZQUIERDA + w, caja.top + top);
    };
    marcas.push(grupo);
    svg.append(grupo);
  });
  // Metas: línea vertical verde punteada de arriba abajo (el nombre va en las convenciones).
  for (const m of g.metas) {
    const x = IZQUIERDA + (m.valor / tope) * largo;
    svg.append(nodo('line', { x1: x, x2: x, y1: 0, y2: alto, class: 'ofe-meta' }));
  }
  conTeclado(g, svg, n, i => marcas[i].mostrar?.(), () => { svg.classList.remove('t1-enfoque'); marcas.forEach(m => m.classList.remove('t1-activa')); });
  return svg;
}

/** Columnas (una serie o varias lado a lado). El valor va sobre cada columna si cabe. */
/** "altoPedido": alto que debe ocupar todo el gráfico (para igualar la tabla de al lado); si no, sale del ancho. */
function dibujarColumnas(g: Grafico, ancho: number, altoPedido?: number): SVGSVGElement {
  const n = g.categorias.length;
  // Una serie sin ningún dato no ocupa lugar: las otras quedan centradas.
  const activas = g.series.map((_, s) => s).filter(s => !sinSerie(g, s));
  const k = Math.max(1, activas.length);
  const maximo = Math.max(...g.categorias.flatMap(c => c.valores).map(v => v ?? 0));
  const marcas = marcasEje(maximo * 1.05);
  const tope = marcas[marcas.length - 1];
  const etiquetasEje = marcas.map(g.medida.eje);
  const IZQUIERDA = Math.round(Math.max(...etiquetasEje.map(t => anchoTexto(t))) + 14);
  const DERECHA = 8;
  const ARRIBA = 22;
  const largo = Math.max(60, ancho - IZQUIERDA - DERECHA);
  const hueco = largo / n;
  const grosor = Math.max(3, Math.min(24, (hueco * 0.72 - 2 * (k - 1)) / k));
  const ABAJO = 30;
  const ALTO = Math.round(altoPedido ? Math.min(420, Math.max(140, altoPedido - ARRIBA - ABAJO)) : Math.min(210, Math.max(140, ancho * 0.24)));
  const base = ARRIBA + ALTO;
  const altoTotal = base + ABAJO;
  const yDe = (v: number) => base - (v / tope) * ALTO;
  const masAncha = Math.max(...g.categorias.map(c => anchoTexto(c.etiqueta)));
  const saltar = Math.max(1, Math.ceil((masAncha + 10) / hueco));
  const filtra = !!g.dimension;
  const svg = nodo('svg', { width: ancho, height: altoTotal, viewBox: `0 0 ${ancho} ${altoTotal}`, class: `t1-svg${filtra ? ' t1-filtra' : ''}${g.seleccion.size ? ' t1-con-seleccion' : ''}`, tabindex: 0, role: 'img' });
  svg.setAttribute('aria-label', etiquetaAccesible(g, 'grupo', `Usa las flechas para leer cada uno${filtra ? ' y Enter para filtrar la página' : ''}.`));
  marcas.forEach((m, i) => {
    const y = yDe(m);
    svg.append(nodo('line', { x1: IZQUIERDA, x2: ancho - DERECHA, y1: y, y2: y, class: m ? 't1-guia' : 't1-base' }));
    svg.append(nodo('text', { x: IZQUIERDA - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 't1-eje' }, etiquetasEje[i]));
  });
  // Cifras: si caben sobre cada columna (con varias series, sobre su propia columna).
  const espacio = k > 1 ? grosor + 6 : hueco - 4;
  const caben = g.categorias.every(c => c.valores.every(v => v === null || anchoTexto(g.medida.corta(v), 11) <= espacio));
  const columnas: Marca[] = [];
  g.categorias.forEach((c, i) => {
    const centro = IZQUIERDA + hueco * (i + 0.5);
    const elegida = g.seleccion.has(c.clave);
    const grupo: Marca = nodo('g', { class: `t1-marca${elegida ? ' t1-elegida' : ''}${g.seleccion.size && !elegida ? ' t1-atenuada' : ''}`, style: `--i:${i}` });
    grupo.append(nodo('rect', { x: IZQUIERDA + hueco * i + 1, y: ARRIBA - 18, width: Math.max(1, hueco - 2), height: ALTO + 18 + ABAJO - 4, rx: 6, class: 't1-zona' }));
    const anchoGrupo = k * grosor + (k - 1) * 2;
    activas.forEach((s, posicion) => {
      const v = c.valores[s];
      const x = centro - anchoGrupo / 2 + posicion * (grosor + 2);
      if (v === null) return;
      const alto = (v / tope) * ALTO;
      if (alto > 0.5) {
        const r = Math.min(4, grosor / 2, alto);
        const barra = nodo('g', { class: 't1-barra-v' });
        barra.append(nodo('path', { class: `t1-parte ${c.clase ?? g.series[s].clase}`, d: `M${x} ${base}V${base - alto + r}a${r} ${r} 0 0 1 ${r} ${-r}h${grosor - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${base}z` }));
        grupo.append(barra);
      }
      if (caben) grupo.append(nodo('text', { x: x + grosor / 2, y: yDe(v) - 6, 'text-anchor': 'middle', class: 't1-cifra t1-cifra-col' }, g.medida.corta(v)));
    });
    if (i % saltar === 0) grupo.append(nodo('text', { x: centro, y: base + 18, 'text-anchor': 'middle', class: `t1-eje t1-eje-x${elegida ? ' t1-eje-elegido' : ''}` }, c.etiqueta));
    const mayor = Math.max(...c.valores.map(v => v ?? 0));
    const mostrar = (cx: number, cy: number) => {
      svg.classList.add('t1-enfoque');
      columnas.forEach((col, j) => col.classList.toggle('t1-activa', j === i));
      mostrarTip(c.titulo, filasTip(g, c), cx, cy, pistaDe(g, c));
    };
    grupo.addEventListener('pointermove', evento => { g.foco = i; mostrar(evento.clientX, evento.clientY); });
    grupo.addEventListener('pointerleave', () => { svg.classList.remove('t1-enfoque'); grupo.classList.remove('t1-activa'); ocultarTip(); });
    if (filtra) grupo.addEventListener('click', () => alternar(g.dimension!, c.clave));
    grupo.mostrar = () => {
      const caja = svg.getBoundingClientRect();
      mostrar(caja.left + centro, caja.top + yDe(mayor));
    };
    columnas.push(grupo);
    svg.append(grupo);
  });
  conTeclado(g, svg, n, i => columnas[i].mostrar?.(), () => { svg.classList.remove('t1-enfoque'); columnas.forEach(col => col.classList.remove('t1-activa')); });
  return svg;
}

/** Líneas de 2 px con un punto por día; una línea vertical sigue al puntero y la ventanita lee las tres series. */
function dibujarLinea(g: Grafico, ancho: number): SVGSVGElement {
  const n = g.categorias.length;
  const valores = g.categorias.flatMap(c => c.valores).filter((v): v is number => v !== null);
  const marcas = marcasEje(Math.max(...valores) * 1.05);
  const tope = marcas[marcas.length - 1];
  const etiquetasEje = marcas.map(g.medida.eje);
  const IZQUIERDA = Math.round(Math.max(...etiquetasEje.map(t => anchoTexto(t))) + 14);
  const DERECHA = Math.round(Math.max(42, ...valores.map(v => anchoTexto(g.medida.corta(v)) + 14)));
  const ARRIBA = 14;
  const ALTO = Math.round(Math.min(200, Math.max(150, ancho * 0.2)));
  const ABAJO = 30;
  const base = ARRIBA + ALTO;
  const altoTotal = base + ABAJO;
  const largo = Math.max(60, ancho - IZQUIERDA - DERECHA);
  const yDe = (v: number) => base - (v / tope) * ALTO;
  const continuo = n > 1 && g.categorias.every(c => c.x !== undefined);
  const x0 = g.categorias[0].x ?? 0;
  const x1 = g.categorias[n - 1].x ?? 0;
  const xDe = (i: number) => (continuo ? IZQUIERDA + 10 + ((g.categorias[i].x! - x0) / (x1 - x0)) * (largo - 20) : IZQUIERDA + (largo / n) * (i + 0.5));
  const svg = nodo('svg', { width: ancho, height: altoTotal, viewBox: `0 0 ${ancho} ${altoTotal}`, class: 't1-svg t1-svg-linea', tabindex: 0, role: 'img' });
  svg.setAttribute('aria-label', etiquetaAccesible(g, 'punto', 'Usa las flechas izquierda y derecha para leer cada uno.'));
  marcas.forEach((m, i) => {
    const y = yDe(m);
    svg.append(nodo('line', { x1: IZQUIERDA, x2: ancho - DERECHA + 8, y1: y, y2: y, class: m ? 't1-guia' : 't1-base' }));
    svg.append(nodo('text', { x: IZQUIERDA - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 't1-eje' }, etiquetasEje[i]));
  });
  const caben = Math.max(2, Math.floor(largo / (Math.max(...g.categorias.map(c => anchoTexto(c.etiqueta))) + 16)));
  const saltar = Math.max(1, Math.ceil(n / caben));
  g.categorias.forEach((c, i) => {
    if (i % saltar === 0) svg.append(nodo('text', { x: xDe(i), y: base + 18, 'text-anchor': 'middle', class: 't1-eje t1-eje-x' }, c.etiqueta));
  });
  const conPuntos = n <= 45;
  const cifrasFinales: number[] = [];
  g.series.forEach((s, k) => {
    let d = '';
    let abierto = false;
    const aislados: number[] = [];
    g.categorias.forEach((c, i) => {
      const v = c.valores[k];
      if (v === null) { abierto = false; return; }
      const solo = (i === 0 || g.categorias[i - 1].valores[k] === null) && (i === n - 1 || g.categorias[i + 1].valores[k] === null);
      if (solo) aislados.push(i);
      d += `${abierto ? 'L' : 'M'}${xDe(i).toFixed(1)} ${yDe(v).toFixed(1)}`;
      abierto = true;
    });
    if (!d) return;
    svg.append(nodo('path', { d, class: `t1-linea ${s.clase}`, pathLength: 1 }));
    const puntos = nodo('g', { class: 't1-puntos' });
    g.categorias.forEach((c, i) => {
      const v = c.valores[k];
      if (v === null || (!conPuntos && !aislados.includes(i))) return;
      puntos.append(nodo('circle', { cx: xDe(i), cy: yDe(v), r: 3.5, class: `t1-punto ${s.clase}` }));
    });
    svg.append(puntos);
    // Cifra al final de cada línea (si no choca con otra).
    let ultimo = -1;
    for (let i = n - 1; i >= 0; i--) if (g.categorias[i].valores[k] !== null) { ultimo = i; break; }
    const y = yDe(g.categorias[ultimo].valores[k]!);
    if (!cifrasFinales.some(u => Math.abs(u - y) < 15)) {
      cifrasFinales.push(y);
      svg.append(nodo('text', { x: xDe(ultimo) + 8, y, 'dominant-baseline': 'central', class: 't1-cifra t1-cifra-final' }, g.medida.corta(g.categorias[ultimo].valores[k])));
    }
  });
  const cruz = nodo('line', { x1: 0, x2: 0, y1: ARRIBA - 4, y2: base, class: 't1-cruz', visibility: 'hidden' });
  const focos = g.series.map(s => nodo('circle', { r: 5, class: `t1-punto t1-punto-foco ${s.clase}`, visibility: 'hidden' }));
  const captura = nodo('rect', { x: IZQUIERDA, y: ARRIBA - 8, width: largo, height: ALTO + 8, class: 't1-captura' });
  svg.append(cruz, ...focos, captura);
  const mostrar = (i: number, cx?: number, cy?: number) => {
    const c = g.categorias[i];
    const x = xDe(i);
    cruz.setAttribute('x1', String(x));
    cruz.setAttribute('x2', String(x));
    cruz.setAttribute('visibility', 'visible');
    focos.forEach((f, k) => {
      const v = c.valores[k];
      f.setAttribute('visibility', v === null ? 'hidden' : 'visible');
      if (v !== null) { f.setAttribute('cx', String(x)); f.setAttribute('cy', String(yDe(v))); }
    });
    const caja = svg.getBoundingClientRect();
    const arriba = Math.min(...c.valores.map(v => (v === null ? base : yDe(v))));
    mostrarTip(c.titulo, filasTip(g, c), cx ?? caja.left + x, cy ?? caja.top + arriba);
  };
  const limpiar = () => { cruz.setAttribute('visibility', 'hidden'); focos.forEach(f => f.setAttribute('visibility', 'hidden')); };
  captura.addEventListener('pointermove', evento => {
    const px = evento.clientX - svg.getBoundingClientRect().left;
    let mejor = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xDe(i) - px) < Math.abs(xDe(mejor) - px)) mejor = i;
    g.foco = mejor;
    mostrar(mejor, evento.clientX, evento.clientY);
  });
  captura.addEventListener('pointerleave', () => { limpiar(); ocultarTip(); });
  conTeclado(g, svg, n, i => mostrar(i), limpiar);
  return svg;
}

/** Barras por página en las listas largas (máquinas). */
const POR_PAGINA = 10;

/** La página que se ve de un gráfico paginado: comparte todo con el gráfico, menos las categorías (solo las de la página);
 *  el foco del teclado se guarda en el gráfico con su posición en la lista completa. */
function paginaDe(g: Grafico): Grafico {
  const inicio = g.pagina * POR_PAGINA;
  const categorias = g.categorias.slice(inicio, inicio + POR_PAGINA);
  return Object.create(g, {
    categorias: { value: categorias },
    foco: { get: () => Math.max(0, Math.min(categorias.length - 1, g.foco - inicio)), set: (i: number) => { g.foco = inicio + i; } },
  }) as Grafico;
}

/** Flechas ‹ › y números de página, con "1–15 de 47" (gráficos por máquina, lista de montacargas y chasis del aviso).
 *  "ir" cambia de página y vuelve a pintar; luego el foco queda en el mismo botón (o en el número de la página nueva). */
function crearPaginas(nombre: string, total: number, pagina: number, porPagina: number, contenedor: () => ParentNode, ir: (pagina: number) => void): HTMLElement {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = pagina * porPagina;
  const nav = crear('nav', 'ofe-paginas');
  nav.setAttribute('aria-label', `Páginas de ${nombre}`);
  const boton = (texto: string, etiqueta: string, destino: number, accion: string, clase = '') => {
    const b = crear('button', `ofe-pagina${clase}`, texto);
    b.type = 'button';
    b.dataset.accion = accion;
    b.setAttribute('aria-label', etiqueta);
    b.disabled = destino < 0 || destino >= paginas;
    b.addEventListener('click', () => {
      ir(destino);
      const zona = contenedor();
      (zona.querySelector<HTMLButtonElement>(`.ofe-paginas [data-accion="${accion}"]:not(:disabled)`) ?? zona.querySelector<HTMLButtonElement>('.ofe-paginas .activa'))?.focus({ preventScroll: true });
    });
    return b;
  };
  // Con muchas páginas: la primera, la última, la actual y sus vecinas, con "…" en los saltos (en celular, sin las vecinas).
  const visibles = paginas <= 7 ? Array.from({ length: paginas }, (_, p) => p)
    : [...new Set([0, pagina - 1, pagina, pagina + 1, paginas - 1])].filter(p => p >= 0 && p < paginas).sort((a, b) => a - b);
  const numeros: HTMLElement[] = [];
  visibles.forEach((p, i) => {
    if (i && p - visibles[i - 1] > 1) numeros.push(crear('span', 'ofe-paginas-salto', '…'));
    const vecina = paginas > 7 && p !== pagina && p !== 0 && p !== paginas - 1;
    const b = boton(String(p + 1), `Página ${p + 1} de ${paginas}`, p, `p${p}`, `${p === pagina ? ' activa' : ''}${vecina ? ' vecina' : ''}`);
    if (p === pagina) b.setAttribute('aria-current', 'page');
    numeros.push(b);
  });
  nav.append(
    boton('‹', 'Página anterior', pagina - 1, 'anterior', ' flecha'),
    ...numeros,
    boton('›', 'Página siguiente', pagina + 1, 'siguiente', ' flecha'),
    crear('span', 'ofe-paginas-texto', `${cifra(inicio + 1)}–${cifra(Math.min(total, inicio + porPagina))} de ${cifra(total)}`),
  );
  return nav;
}
function paginador(g: Grafico): HTMLElement {
  return crearPaginas(g.nombre, g.categorias.length, g.pagina, POR_PAGINA, () => g.caja, pagina => {
    g.pagina = pagina;
    g.foco = pagina * POR_PAGINA;
    ocultarTip();
    dibujar(g);
  });
}

/** Alto del elemento de al lado (g.igualarA) si las dos tarjetas están en la misma fila; si no (pantalla angosta), nada. */
function altoJunto(g: Grafico): number | undefined {
  const vecino = g.igualarA;
  const propia = g.caja.closest<HTMLElement>('.t1-card');
  const otra = vecino?.closest<HTMLElement>('.t1-card');
  if (!vecino || !propia || !otra || propia.offsetTop !== otra.offsetTop) return undefined;
  return vecino.offsetHeight || undefined;
}

function dibujar(g: Grafico, animar = true) {
  const ancho = Math.floor(g.caja.clientWidth);
  g.ancho = ancho;
  g.caja.classList.toggle('t1-quieto', !animar);
  if (g.caja.contains(document.querySelector('.t1-activa'))) ocultarTip();
  // Si el gráfico tenía el foco (Enter para filtrar), lo recupera al redibujarse; el recuadro conserva su posición.
  const conFoco = g.caja.contains(document.activeElement) && document.activeElement instanceof SVGSVGElement;
  if (!hayDatos(g)) { g.caja.replaceChildren(crear('p', 't1-grafico-vacio', g.vacio)); return; }
  const paginas = g.paginar ? Math.ceil(g.categorias.length / POR_PAGINA) : 1;
  g.pagina = Math.max(0, Math.min(g.pagina, paginas - 1));
  const pie = paginas > 1 ? [paginador(g)] : [];
  const vista = paginas > 1 ? paginaDe(g) : g;
  if (g.enTabla) { g.caja.replaceChildren(tablaDe(vista), ...pie); return; }
  if (!ancho) return; // Oculto: se dibuja al mostrarse (ResizeObserver).
  let svg: SVGSVGElement;
  if (g.forma === 'barras' && pie.length) {
    svg = dibujarBarras(vista, ancho, g.categorias);
    g.caja.replaceChildren(svg, ...pie);
  } else {
    svg = g.forma === 'linea' ? dibujarLinea(g, ancho) : g.forma === 'barras' ? dibujarBarras(g, ancho) : dibujarColumnas(g, ancho, altoJunto(g));
    const leyenda = leyendaDe(g);
    g.caja.replaceChildren(...(leyenda ? [leyenda, svg] : [svg]));
  }
  if (conFoco) svg.focus({ preventScroll: true });
}

function ponerCategorias(g: Grafico, categorias: Categoria[], subtitulo?: string) {
  const firma = (l: Categoria[]) => l.map(c => c.clave).join('|');
  if (g.paginar && firma(categorias) !== firma(g.categorias)) { g.pagina = 0; g.foco = 0; }
  g.categorias = categorias;
  g.foco = Math.min(g.foco, Math.max(0, categorias.length - 1));
  if (g.subtitulo && subtitulo !== undefined) g.subtitulo.textContent = subtitulo;
  dibujar(g);
}

for (const g of Object.values(graficos)) {
  let cuadro = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(cuadro);
    cuadro = requestAnimationFrame(() => { if (Math.floor(g.caja.clientWidth) !== g.ancho) dibujar(g, false); });
  }).observe(g.caja);
}
for (const boton of document.querySelectorAll<HTMLButtonElement>('.t1-ver-tabla')) {
  boton.addEventListener('click', () => {
    const g = graficos[boton.dataset.grafico ?? ''];
    if (!g) return;
    g.enTabla = !g.enTabla;
    boton.setAttribute('aria-pressed', String(g.enTabla));
    boton.textContent = g.enTabla ? 'Ver gráfico' : 'Ver tabla';
    dibujar(g, false);
  });
}

// ---------- Dona: composición de las horas encendido ----------

const donaCaja = porId('ofeGComposicion');
const donaSubtitulo = porId('ofeGComposicionS');

function pintarDona(c: ResultadoOfe['composicion'], hayFilas: boolean) {
  const partes = [{ serie: enPosicion(CARGA, 1), v: c.carga }, { serie: enPosicion(MOVIMIENTO, 2), v: c.movimiento }, { serie: enPosicion(RALENTI, 3), v: c.ralenti }];
  const total = partes.reduce((s, p) => s + p.v, 0);
  donaSubtitulo.textContent = 'Suma de horas encendido: carga + movimiento + ralentí';
  if (!hayFilas || total <= 0) { donaCaja.replaceChildren(crear('p', 't1-grafico-vacio', 'Sin registros con estos filtros.')); return; }
  const parte = (v: number) => v / total;
  const R = 78, GROSOR = 26, CENTRO = 100;
  const svg = nodo('svg', { viewBox: '0 0 200 200', class: 'ofe-dona', role: 'img', tabindex: 0 });
  svg.setAttribute('aria-label', `Composición de horas: ${partes.map(p => `${p.serie.corto} ${horas1(p.v)} horas, ${porcentaje(parte(p.v))}`).join('; ')}. Total encendido ${horas1(total)} horas. Usa las flechas para leer cada parte.`);
  svg.append(nodo('circle', { cx: CENTRO, cy: CENTRO, r: R, class: 'ofe-dona-pista', 'stroke-width': GROSOR }));
  const conValor = partes.filter(p => p.v > 0).length;
  // 2 px de separación entre partes (en unidades de pathLength = 100).
  const hueco = conValor > 1 ? (2.5 / (2 * Math.PI * R)) * 100 : 0;
  const segmentos: (SVGCircleElement | null)[] = [];
  const items: HTMLLIElement[] = [];
  let inicio = 0;
  const activar = (i: number | null) => {
    svg.classList.toggle('ofe-enfoque', i !== null);
    segmentos.forEach((s, k) => s?.classList.toggle('ofe-activo', k === i));
    items.forEach((li, k) => li.classList.toggle('ofe-activo', k === i));
  };
  const filasDe = (i: number): FilaTip[] => [
    { nombre: partes[i].serie.nombre, valor: horasLargo(partes[i].v), clase: partes[i].serie.clase, fuerte: true },
    { nombre: 'Del tiempo encendido', valor: porcentajeLargo(parte(partes[i].v)) },
  ];
  partes.forEach((p, i) => {
    if (p.v <= 0) { segmentos.push(null); return; }
    const largo = parte(p.v) * 100;
    const trazo = Math.max(0.25, largo - hueco);
    const seg = nodo('circle', {
      cx: CENTRO, cy: CENTRO, r: R, pathLength: 100, 'stroke-width': GROSOR, class: `ofe-dona-seg ${p.serie.clase}`,
      'stroke-dasharray': `${trazo} ${100 - trazo}`, 'stroke-dashoffset': -(inicio + hueco / 2), transform: `rotate(-90 ${CENTRO} ${CENTRO})`,
      style: `--i:${i}`,
    });
    seg.addEventListener('pointermove', evento => { activar(i); mostrarTip(p.serie.corto, filasDe(i), evento.clientX, evento.clientY); });
    seg.addEventListener('pointerleave', () => { activar(null); ocultarTip(); });
    svg.append(seg);
    segmentos.push(seg);
    inicio += largo;
  });
  // Teclado: flechas para pasar por las partes.
  let foco = 0;
  const conDato = partes.map((p, i) => (p.v > 0 ? i : -1)).filter(i => i >= 0);
  const enfocar = (k: number) => {
    foco = (k + conDato.length) % conDato.length;
    const i = conDato[foco];
    activar(i);
    const caja = svg.getBoundingClientRect();
    mostrarTip(partes[i].serie.corto, filasDe(i), caja.left + caja.width / 2, caja.top + 10);
    anuncio.textContent = `${partes[i].serie.corto}: ${horas1(partes[i].v)} horas, ${porcentaje(parte(partes[i].v))} del tiempo encendido`;
  };
  svg.addEventListener('focus', () => enfocar(foco));
  svg.addEventListener('blur', () => { activar(null); ocultarTip(); });
  svg.addEventListener('keydown', evento => {
    if (['ArrowRight', 'ArrowDown'].includes(evento.key)) { evento.preventDefault(); enfocar(foco + 1); }
    else if (['ArrowLeft', 'ArrowUp'].includes(evento.key)) { evento.preventDefault(); enfocar(foco - 1); }
    else if (evento.key === 'Escape') ocultarTip();
  });
  const centro = crear('div', 'ofe-dona-centro');
  centro.append(crear('strong', undefined, conH(horas1(total))), crear('span', undefined, 'encendido'));
  const figura = crear('div', 'ofe-dona-figura');
  figura.append(svg, centro);

  // Leyenda con horas y porcentaje: las cifras se leen sin pasar el puntero.
  const leyenda = crear('ul', 'ofe-dona-leyenda');
  leyenda.setAttribute('aria-label', 'Detalle de la composición de horas');
  partes.forEach((p, i) => {
    const li = crear('li', 'ofe-dona-item');
    li.style.setProperty('--i', String(i));
    const nombre = crear('span', 'ofe-dona-nombre');
    nombre.append(crear('i', `t1-muestra ${p.serie.clase}`), p.serie.corto);
    const cifras = crear('span', 'ofe-dona-cifras');
    cifras.append(crear('b', undefined, conH(horas1(p.v))), crear('small', undefined, porcentaje(parte(p.v))));
    li.append(nombre, cifras);
    if (segmentos[i]) {
      li.addEventListener('pointerenter', () => activar(i));
      li.addEventListener('pointerleave', () => activar(null));
    }
    items.push(li);
    leyenda.append(li);
  });
  const caja = crear('div', 'ofe-dona-caja');
  caja.append(figura, leyenda);
  donaCaja.replaceChildren(caja);
}

// ---------- Tabla: horas por CD ----------

type FilaCd = ResultadoOfe['porCd'][number];
interface ColumnaCd { titulo: string; num?: boolean; texto: (f: FilaCd) => string; extra?: (f: FilaCd) => string; orden: (a: FilaCd, b: FilaCd) => number; primero?: 1 | -1 }
const porNumero = (valor: (f: FilaCd) => number | null) => (a: FilaCd, b: FilaCd) => (valor(a) ?? -1) - (valor(b) ?? -1);
const COLUMNAS_CD: ColumnaCd[] = [
  { titulo: 'CD', texto: f => f.cd, orden: (a, b) => porTexto(a.cd, b.cd) },
  { titulo: 'Horas carga', num: true, texto: f => horas1(f.carga), orden: porNumero(f => f.carga), primero: -1 },
  { titulo: 'Horas movimiento', num: true, texto: f => horas1(f.movimiento), orden: porNumero(f => f.movimiento), primero: -1 },
  { titulo: 'Horas ralentí', num: true, texto: f => horas1(f.ralenti), orden: porNumero(f => f.ralenti), primero: -1 },
  { titulo: 'OFE', num: true, texto: f => porcentaje(f.ofe), orden: porNumero(f => f.ofe), primero: -1 },
];
const tablaCd = (() => {
  const zona = porId('ofeTCd');
  const caja = crear('div', 't1-tabla-caja');
  caja.setAttribute('role', 'region');
  caja.tabIndex = 0;
  caja.setAttribute('aria-label', 'Tabla: horas por CD');
  const tabla = crear('table', 't1-tabla ofe-tabla');
  tabla.append(crear('caption', 'cc-oculto', 'Horas de carga, movimiento y ralentí, y OFE de cada CD'));
  const cabeza = tabla.createTHead().insertRow();
  const cuerpo = tabla.createTBody();
  const pie = tabla.createTFoot();
  caja.append(tabla);
  zona.replaceChildren(caja);
  const t = { filas: [] as FilaCd[], total: null as ResultadoOfe['tarjetas'] | null, orden: { col: 0, dir: 1 as 1 | -1 }, cabeza, cuerpo, pie };
  COLUMNAS_CD.forEach((col, i) => {
    const th = crear('th', col.num ? 'num' : undefined);
    th.scope = 'col';
    const b = crear('button', 't1-orden');
    b.type = 'button';
    b.append(crear('span', undefined, col.titulo), crear('i', 't1-orden-flecha'));
    b.addEventListener('click', () => {
      t.orden = t.orden.col === i ? { col: i, dir: (t.orden.dir * -1) as 1 | -1 } : { col: i, dir: col.primero ?? 1 };
      pintarTablaCd();
    });
    th.append(b);
    cabeza.append(th);
  });
  return t;
})();

function pintarTablaCd() {
  const t = tablaCd;
  const { col, dir } = t.orden;
  const vista = [...t.filas].sort((a, b) => dir * COLUMNAS_CD[col].orden(a, b) || porTexto(a.cd, b.cd));
  [...t.cabeza.cells].forEach((th, i) => th.setAttribute('aria-sort', col === i ? (dir === 1 ? 'ascending' : 'descending') : 'none'));
  if (!vista.length) {
    const tr = crear('tr', 't1-fila-vacia ofe-fila-vacia');
    const td = crear('td', undefined, 'Sin registros con estos filtros.');
    td.colSpan = COLUMNAS_CD.length;
    tr.append(td);
    t.cuerpo.replaceChildren(tr);
    t.pie.replaceChildren();
    return;
  }
  t.cuerpo.replaceChildren(...vista.map((f, i) => {
    const tr = crear('tr');
    tr.style.setProperty('--f', String(i));
    COLUMNAS_CD.forEach((c, k) => {
      const celda = crear(k === 0 ? 'th' : 'td', c.num ? 'num' : undefined, c.texto(f));
      if (k === 0) (celda as HTMLTableCellElement).scope = 'row';
      tr.append(celda);
    });
    return tr;
  }));
  // Total: las sumas y el OFE promedio de todos los registros (como el total de la tabla del Power BI).
  const total = t.total;
  if (!total) { t.pie.replaceChildren(); return; }
  const tr = crear('tr');
  const th = crear('th', undefined, 'Total');
  th.scope = 'row';
  tr.append(th, crear('td', 'num', horas1(total.carga)), crear('td', 'num', horas1(total.movimiento)), crear('td', 'num', horas1(total.ralenti)), crear('td', 'num', porcentaje(total.ofe)));
  t.pie.replaceChildren(tr);
}

// ---------- Filtros ----------

/** Lista desplegable con casillas (CD y máquina), como los segmentadores de selección múltiple. */
interface Multi { dim: 'cds' | 'maquinas'; raiz: HTMLElement; boton: HTMLButtonElement; valor: HTMLElement; panel: HTMLElement; lista: HTMLElement; nombre: string; todos: string; busqueda: HTMLInputElement | null; nada: HTMLElement }
function crearMulti(id: string, dim: Multi['dim'], nombre: string, todos: string, conBusqueda: boolean): Multi {
  const raiz = porId(id);
  const etiqueta = raiz.querySelector('.t1-etiqueta')!;
  const boton = crear('button', 't1-multi-boton');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');
  boton.setAttribute('aria-controls', `${id}Panel`);
  const valor = crear('span', 't1-multi-valor', todos);
  valor.id = `${id}Valor`;
  boton.setAttribute('aria-labelledby', `${etiqueta.id} ${valor.id}`);
  boton.append(valor, icono('m6 9 6 6 6-6'));
  const panel = crear('div', 't1-multi-panel');
  panel.id = `${id}Panel`;
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-labelledby', etiqueta.id);
  const quitar = crear('button', 't1-multi-todos', `${todos} (quitar el filtro de ${nombre})`);
  quitar.type = 'button';
  const lista = crear('div', 't1-multi-lista');
  const nada = crear('p', 'ofe-multi-nada', `Ninguna ${nombre} coincide.`);
  nada.hidden = true;
  let busqueda: HTMLInputElement | null = null;
  if (conBusqueda) {
    // Muchas placas: un buscador arriba de la lista.
    const caja = crear('label', 't1-buscar ofe-multi-buscar');
    busqueda = crear('input');
    busqueda.type = 'search';
    busqueda.placeholder = 'Buscar placa o CD';
    busqueda.autocomplete = 'off';
    busqueda.spellcheck = false;
    busqueda.setAttribute('aria-label', `Buscar ${nombre} por placa o CD`);
    caja.append(icono('M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8'), busqueda);
    panel.append(caja);
  }
  panel.append(quitar, lista, nada);
  raiz.append(boton, panel);
  const m: Multi = { dim, raiz, boton, valor, panel, lista, nombre, todos, busqueda, nada };
  boton.addEventListener('click', () => abrirMulti(m, panel.hidden !== false));
  quitar.addEventListener('click', () => {
    filtro[dim] = [];
    anuncio.textContent = `Se quitó el filtro de ${nombre}.`;
    pintarFiltros();
    recalcular();
  });
  busqueda?.addEventListener('input', () => aplicarBusqueda(m));
  panel.addEventListener('keydown', evento => { if (evento.key === 'Escape') { abrirMulti(m, false); boton.focus(); } });
  lista.addEventListener('change', evento => {
    const casilla = evento.target as HTMLInputElement;
    const elegidos = filtro[dim];
    const i = elegidos.indexOf(casilla.value);
    if (casilla.checked && i < 0) elegidos.push(casilla.value);
    if (!casilla.checked && i >= 0) elegidos.splice(i, 1);
    elegidos.sort(porTexto);
    if (dim === 'cds') podarMaquinas();
    pintarFiltros();
    recalcular();
  });
  return m;
}
const multis = [crearMulti('ofeMultiCds', 'cds', 'CD', 'Todos', false), crearMulti('ofeMultiMaquinas', 'maquinas', 'máquina', 'Todas', true)];
function abrirMulti(m: Multi, abrir: boolean) {
  for (const otro of multis) if (otro !== m || !abrir) { otro.panel.hidden = true; otro.boton.setAttribute('aria-expanded', 'false'); }
  if (abrir) { m.panel.hidden = false; m.boton.setAttribute('aria-expanded', 'true'); m.panel.querySelector<HTMLElement>('input, button')?.focus(); }
}
document.addEventListener('pointerdown', evento => {
  for (const m of multis) if (!m.panel.hidden && !m.raiz.contains(evento.target as Node)) abrirMulti(m, false);
});

/** Máquinas que se pueden elegir: las de los CD elegidos (o todas). */
const maquinasDisponibles = () => (opciones?.maquinas ?? []).filter(x => !filtro.cds.length || filtro.cds.includes(x.cd));
/** Al cambiar los CD, se quitan las máquinas elegidas que ya no pertenecen a ellos. */
function podarMaquinas() {
  if (!filtro.cds.length) return;
  filtro.maquinas = filtro.maquinas.filter(m => filtro.cds.includes(cdDeMaquina.get(m) ?? ''));
}

function llenarMulti(m: Multi) {
  if (!opciones) return;
  const items = m.dim === 'cds'
    ? opciones.cds.map(cd => ({ valor: cd, texto: cd, detalle: '' }))
    : maquinasDisponibles().map(x => ({ valor: x.maquina, texto: x.maquina, detalle: x.cd }));
  const elegidos = new Set(filtro[m.dim]);
  m.lista.classList.toggle('t1-multi-lista-2', m.dim === 'cds' && items.length > 8);
  m.lista.classList.toggle('ofe-multi-lista-3', m.dim === 'maquinas' && items.length > 8);
  m.lista.replaceChildren(...items.map(item => {
    const etiqueta = crear('label', 't1-casilla');
    const casilla = crear('input');
    casilla.type = 'checkbox';
    casilla.value = item.valor;
    casilla.checked = elegidos.has(item.valor);
    const texto = crear('span', undefined, item.texto);
    if (item.detalle) texto.append(crear('small', undefined, item.detalle));
    etiqueta.append(casilla, texto);
    return etiqueta;
  }));
  aplicarBusqueda(m);
}
function aplicarBusqueda(m: Multi) {
  const q = normalizar(m.busqueda?.value ?? '');
  let visibles = 0;
  for (const et of m.lista.querySelectorAll<HTMLElement>('.t1-casilla')) {
    const ok = !q || normalizar(et.textContent ?? '').includes(q);
    et.hidden = !ok;
    if (ok) visibles++;
  }
  m.nada.hidden = visibles > 0;
}

const turnosChips = porId('ofeTurnos');
/** Chips de turno: los que trae Data FMS (normalmente A, B y C). */
function llenarTurnos() {
  if (!opciones) return;
  turnosChips.replaceChildren(...opciones.turnos.map(turno => {
    const b = crear('button', 't1-chip', turno);
    b.type = 'button';
    b.dataset.turno = turno;
    b.title = `Turno ${turno}`;
    b.setAttribute('aria-label', `Turno ${turno}`);
    b.setAttribute('aria-pressed', String(filtro.turnos.includes(turno)));
    b.addEventListener('click', () => alternar('turnos', turno));
    return b;
  }));
}

const NOMBRE_DIMENSION: Record<Dimension, string> = { cds: 'CD', maquinas: 'Máquina', turnos: 'Turno' };
/** Pone o quita un valor del filtro (también desde un clic en una barra, como el cruce de filtros del Power BI). */
function alternar(dim: Dimension, valor: string) {
  const lista = filtro[dim];
  const i = lista.indexOf(valor);
  if (i >= 0) lista.splice(i, 1); else lista.push(valor);
  lista.sort(porTexto);
  if (dim === 'cds') podarMaquinas();
  anuncio.textContent = i >= 0 ? `Se quitó el filtro ${NOMBRE_DIMENSION[dim]} ${valor}.` : `Filtro aplicado: ${NOMBRE_DIMENSION[dim]} ${valor}.`;
  pintarFiltros();
  recalcular();
}

const primerDiaMes = (dia: number) => diaDeIso(`${mesDeDia(dia)}-01`);
/** Por defecto: el mes de la última fecha de Data FMS, del día 1 a esa fecha. */
function rangoInicial() {
  if (!opciones || opciones.hasta === null) return;
  filtro.hasta = opciones.hasta;
  filtro.desde = Math.max(opciones.desde ?? opciones.hasta, primerDiaMes(opciones.hasta));
}
function ponerRango(desde: number, hasta: number) {
  filtro.desde = Math.min(desde, hasta);
  filtro.hasta = Math.max(desde, hasta);
  rangoPorDefecto = false;
  pintarFiltros();
  recalcular();
}

function llenarMeses() {
  if (!opciones || opciones.desde === null || opciones.hasta === null) return;
  const meses: string[] = [];
  for (let mes = mesDeDia(opciones.desde); mes <= mesDeDia(opciones.hasta); mes = mesDeDia(finDeMes(mes) + 1)) meses.push(mes);
  campoMes.replaceChildren(new Option('Rango libre', ''), new Option('Todo el periodo', 'todo'), ...meses.reverse().map(m => new Option(nombreMes(m), m)));
}

function pintarFiltros() {
  if (!opciones || opciones.desde === null || opciones.hasta === null) return;
  campoDesde.value = isoDeDia(filtro.desde);
  campoHasta.value = isoDeDia(filtro.hasta);
  campoDesde.min = campoHasta.min = isoDeDia(opciones.desde);
  campoDesde.max = campoHasta.max = isoDeDia(opciones.hasta);
  const mes = mesDeDia(filtro.desde);
  const esMes = filtro.desde === Math.max(opciones.desde, primerDiaMes(filtro.desde)) && filtro.hasta === Math.min(opciones.hasta, finDeMes(mes));
  campoMes.value = filtro.desde === opciones.desde && filtro.hasta === opciones.hasta ? 'todo' : esMes ? mes : '';
  for (const m of multis) {
    llenarMulti(m);
    const elegidos = filtro[m.dim];
    const femenino = m.dim === 'maquinas';
    m.valor.textContent = !elegidos.length ? m.todos : elegidos.length === 1 ? (femenino ? `Máquina ${elegidos[0]}` : elegidos[0]) : `${elegidos.length} ${femenino ? 'elegidas' : 'elegidos'}`;
    m.boton.classList.toggle('t1-con-valor', elegidos.length > 0);
  }
  for (const b of turnosChips.querySelectorAll<HTMLButtonElement>('.t1-chip')) b.setAttribute('aria-pressed', String(filtro.turnos.includes(b.dataset.turno ?? '')));
  pintarActivos();
}

/** Lista de filtros aplicados, cada uno con su botón para quitarlo. */
function pintarActivos() {
  const lista = porId('ofeActivos');
  const items: { texto: string; quitar: () => void }[] = [
    ...filtro.cds.map(v => ({ texto: `CD: ${v}`, quitar: () => alternar('cds', v) })),
    ...filtro.maquinas.map(v => ({ texto: `Máquina: ${v}`, quitar: () => alternar('maquinas', v) })),
    ...filtro.turnos.map(v => ({ texto: `Turno ${v}`, quitar: () => alternar('turnos', v) })),
  ];
  lista.hidden = !items.length;
  lista.replaceChildren(...items.map(item => {
    const li = crear('li');
    const b = crear('button', 't1-activo');
    b.type = 'button';
    b.setAttribute('aria-label', `Quitar filtro ${item.texto}`);
    b.append(crear('span', undefined, item.texto), icono('M7 7l10 10M17 7 7 17'));
    b.addEventListener('click', () => {
      // El foco pasa al siguiente filtro (o al botón de limpiar) para no perderse.
      const siguiente = li.nextElementSibling ?? li.previousElementSibling;
      item.quitar();
      const destino = siguiente ? [...lista.querySelectorAll<HTMLButtonElement>('.t1-activo')].find(x => x.textContent === siguiente.textContent) : null;
      (destino ?? porId<HTMLButtonElement>('ofeLimpiar')).focus();
    });
    li.append(b);
    return li;
  }));
}

function alCambiarFechas() {
  const desde = campoDesde.value || campoHasta.value;
  const hasta = campoHasta.value || campoDesde.value;
  if (!desde || !opciones || opciones.desde === null || opciones.hasta === null) return;
  const limitar = (d: number) => Math.min(opciones!.hasta!, Math.max(opciones!.desde!, d));
  ponerRango(limitar(diaDeIso(desde)), limitar(diaDeIso(hasta)));
}
campoDesde.addEventListener('change', alCambiarFechas);
campoHasta.addEventListener('change', alCambiarFechas);
campoMes.addEventListener('change', () => {
  if (!opciones || opciones.desde === null || opciones.hasta === null || !campoMes.value) return;
  if (campoMes.value === 'todo') { ponerRango(opciones.desde, opciones.hasta); return; }
  const inicio = diaDeIso(`${campoMes.value}-01`);
  ponerRango(Math.max(opciones.desde, inicio), Math.min(opciones.hasta, finDeMes(campoMes.value)));
});
porId('ofeLimpiar').addEventListener('click', () => {
  filtro.cds = []; filtro.maquinas = []; filtro.turnos = [];
  for (const m of multis) if (m.busqueda) m.busqueda.value = '';
  rangoInicial();
  rangoPorDefecto = true;
  anuncio.textContent = 'Se quitaron los filtros.';
  pintarFiltros();
  recalcular();
});

// ---------- Pintar todo ----------

/** Las cifras cuentan desde su valor anterior hasta el nuevo. */
function contar(el: HTMLElement, valor: number | null, formato: (n: number) => string) {
  cancelAnimationFrame(Number(el.dataset.cuadro ?? 0));
  if (valor === null || !Number.isFinite(valor)) { el.textContent = '—'; el.dataset.valor = ''; el.classList.add('t1-sin-dato'); return; }
  el.classList.remove('t1-sin-dato');
  const previo = el.dataset.valor ? Number(el.dataset.valor) : 0;
  el.dataset.valor = String(valor);
  if (sinMovimiento.matches || previo === valor) { el.textContent = formato(valor); return; }
  const inicio = performance.now();
  const paso = (ahora: number) => {
    const t = Math.max(0, Math.min(1, (ahora - inicio) / 800)); // el primer cuadro puede llegar antes de "inicio"
    el.textContent = formato(t < 1 ? previo + (valor - previo) * (1 - (1 - t) ** 3) : valor);
    if (t < 1) el.dataset.cuadro = String(requestAnimationFrame(paso));
  };
  el.dataset.cuadro = String(requestAnimationFrame(paso));
}

const enHoras = (n: number) => conH(horas1(n));

/** Usabilidad entera, como las tarjetas del Power BI ("99 %"). */
const pctUso = (n: number) => `${Math.round(n * 100)} %`;
/** Regla del Power BI para las tarjetas y el gráfico por gerencia de OFE: verde de 99 % a menos de 200 %, rojo de 0 a
 *  menos de 99 %. Son usabilidades de WIP (así está armado el Power BI), no medidas de OFE. */
function nivelUso(v: number | null | undefined): 'ok' | 'bajo' | null {
  if (v == null || v < 0) return null;
  return v >= 0.99 ? (v < 2 ? 'ok' : null) : 'bajo';
}
function tarjetaOfe(id: string, valor: number | null, formato: (n: number) => string, uso: number | null | undefined, nota: string) {
  const el = porId(id);
  contar(el, valor, formato);
  const tarjeta = el.closest('article')!;
  const nivel = valor === null ? null : nivelUso(uso);
  tarjeta.classList.toggle('ofe-kpi-ok', nivel === 'ok');
  tarjeta.classList.toggle('ofe-kpi-bajo', nivel === 'bajo');
  porId(`${id}Nota`).textContent = nota;
  tarjeta.title = nota;
}

function pintarTarjetas(r: ResultadoOfe, w: ResultadoWip | null) {
  const t = r.tarjetas;
  const con = (v: number | null) => (t.filas ? v : null);
  const u = w?.tarjetas.filas ? w.tarjetas : null;
  const sinWip = filasWipOfe ? 'sin registros de WIP en este rango' : 'aún no se ha cargado Data WIP';
  const textoUso = (v: number | null | undefined) => (v == null ? sinWip : pctUso(v));
  tarjetaOfe('ofeKpiRalenti', con(t.ralenti), enHoras, u?.wip,
    `Suma de horas ralentí${t.filas && t.encendido > 0 ? ` (${porcentaje(t.ralenti / t.encendido)} del tiempo encendido)` : ''}. Color: usabilidad WIP ${textoUso(u?.wip)} (verde desde 99 %).`);
  tarjetaOfe('ofeKpiOfe', con(t.ofe), porcentaje, u?.armado, `(Movimiento + carga) / 24 h. Color: usabilidad de armado de WIP ${textoUso(u?.armado)} (verde desde 99 %).`);
  tarjetaOfe('ofeKpiVerif', u ? u.verificacion : null, pctUso, u?.verificacion, `Usabilidad de verificación de WIP: ${textoUso(u?.verificacion)} (verde desde 99 %).`);
  tarjetaOfe('ofeKpiMonta', u ? u.montacargas : null, pctUso, u?.montacargas, `Usabilidad de montacargas de WIP: ${textoUso(u?.montacargas)} (verde desde 99 %).`);
}

const textoRango = () => (filtro.desde === filtro.hasta ? fecha(filtro.desde) : `del ${fecha(filtro.desde)} al ${fecha(filtro.hasta)}`);

function pintarResumen(r: ResultadoOfe) {
  const t = r.tarjetas;
  const partes = [filtro.desde === filtro.hasta ? fechaLarga(filtro.desde) : `Del ${fecha(filtro.desde)} al ${fecha(filtro.hasta)}`];
  partes.push(t.filas ? plural(t.filas, 'registro', 'registros') : 'sin registros con estos filtros');
  if (t.maquinas) partes.push(plural(t.maquinas, 'máquina', 'máquinas'));
  if (r.porCd.length) partes.push(plural(r.porCd.length, 'CD', 'CD'));
  resumenTexto.dataset.tipo = '';
  resumenTexto.textContent = partes.join(' · ');
}

// Aviso: registros cuyo montacargas (chasis) no está en la lista de montacargas; no tienen CD y no se cuentan.
const aviso = porId('ofeAvisoSinCd');
const avisoVer = porId<HTMLButtonElement>('ofeAvisoVer');
const chasisCaja = porId('ofeChasis');
/** Chasis del aviso con sus registros en el rango, de más a menos; se ven de a POR_PAGINA_CHASIS. */
const POR_PAGINA_CHASIS = 12;
let chasisAviso: { chasis: string; registros: number }[] = [];
let paginaChasis = 0;
function pintarAviso(r: ResultadoOfe) {
  const { filas: n, forklifts } = r.sinCd;
  aviso.hidden = !n;
  if (!n) { chasisAviso = []; return; }
  porId('ofeAvisoSinCdTexto').replaceChildren(
    crear('strong', undefined, `${plural(n, 'registro', 'registros')} de ${cifra(forklifts.length)} montacargas`),
    ` no se ${n === 1 ? 'cuenta' : 'cuentan'} porque su chasis no está en la lista de montacargas.`,
  );
  // Los que más registros tienen primero: casi siempre son los montacargas que de verdad trabajan y faltan en la lista.
  const registros = new Map<string, number>();
  for (const f of filas ?? []) if (!f.cd && f.fecha >= filtro.desde && f.fecha <= filtro.hasta) registros.set(f.forklift, (registros.get(f.forklift) ?? 0) + 1);
  const nuevos = forklifts.map(chasis => ({ chasis, registros: registros.get(chasis) ?? 0 })).sort((a, b) => b.registros - a.registros || porTexto(a.chasis, b.chasis));
  if (nuevos.map(c => c.chasis).join('|') !== chasisAviso.map(c => c.chasis).join('|')) paginaChasis = 0;
  chasisAviso = nuevos;
  pintarChasis();
}
function pintarChasis() {
  const paginas = Math.max(1, Math.ceil(chasisAviso.length / POR_PAGINA_CHASIS));
  paginaChasis = Math.max(0, Math.min(paginaChasis, paginas - 1));
  const inicio = paginaChasis * POR_PAGINA_CHASIS;
  porId('ofeChasisLista').replaceChildren(...chasisAviso.slice(inicio, inicio + POR_PAGINA_CHASIS).map(({ chasis, registros }) => {
    const li = crear('li', 'ofe-chasis-item');
    const texto = crear('span', 'ofe-chasis-texto');
    texto.append(crear('code', 'ofe-chasis-codigo', chasis || '(sin chasis)'), crear('small', undefined, ` · ${plural(registros, 'registro', 'registros')}`));
    const agregar = crear('button', 'ofe-chasis-agregar', 'Agregar');
    agregar.type = 'button';
    agregar.disabled = !chasis;
    agregar.setAttribute('aria-label', `Agregar el chasis ${chasis} a la lista de montacargas`);
    agregar.addEventListener('click', () => abrirMontacargas(chasis));
    li.append(texto, agregar);
    return li;
  }));
  const zona = porId('ofeChasisPaginas');
  zona.replaceChildren(...(paginas > 1 ? [crearPaginas('los chasis que faltan', chasisAviso.length, paginaChasis, POR_PAGINA_CHASIS, () => zona, p => { paginaChasis = p; pintarChasis(); })] : []));
  pintarBotonChasis();
}
function pintarBotonChasis() {
  const abierto = !chasisCaja.hidden;
  avisoVer.setAttribute('aria-expanded', String(abierto));
  avisoVer.textContent = abierto ? 'Ocultar chasis' : `Ver chasis (${cifra(chasisAviso.length)})`;
}
avisoVer.addEventListener('click', () => { chasisCaja.hidden = !chasisCaja.hidden; pintarBotonChasis(); });

const porValor = <T>(valor: (x: T) => number | null) => (a: T, b: T) => (valor(b) ?? -1) - (valor(a) ?? -1);

function pintarGraficos(r: ResultadoOfe, rTur: ResultadoOfe, rMaq: ResultadoOfe, w: ResultadoWip | null) {
  graficos.turno.seleccion = new Set(filtro.turnos);
  ponerCategorias(graficos.turno, rTur.porTurno.map(t => ({ clave: t.turno, etiqueta: `Turno ${t.turno}`, titulo: `Turno ${t.turno} · promedio por montacargas`, valores: [t.ralenti, t.carga, t.movimiento] })));

  ponerCategorias(graficos.dia, r.porDia.map(d => ({ clave: String(d.fecha), etiqueta: diaCorto(d.fecha), titulo: fechaLarga(d.fecha), valores: [d.encendido, d.movimiento, d.carga], x: d.fecha })),
    `${plural(r.porDia.length, 'día', 'días')} · ${textoRango()}`);

  const maquinas = rMaq.porMaquina;
  const titulo = (m: (typeof maquinas)[number]) => `Máquina ${m.maquina} · ${m.cd}`;
  const porPagina = maquinas.length > POR_PAGINA ? ` · ${POR_PAGINA} por página` : '';
  for (const g of [graficos.maquinaRalenti, graficos.maquinaOfe]) g.seleccion = new Set(filtro.maquinas);
  ponerCategorias(graficos.maquinaRalenti, maquinas.map(m => ({
    clave: m.maquina, etiqueta: m.maquina, detalle: m.cd, titulo: titulo(m), valores: [m.ralenti], extra: [{ nombre: 'OFE', valor: porcentajeLargo(m.ofe) }],
  })), `${plural(maquinas.length, 'máquina', 'máquinas')} · suma de horas · de mayor a menor${porPagina}`);
  ponerCategorias(graficos.maquinaOfe, [...maquinas].sort((a, b) => porValor<typeof a>(m => m.ofe)(a, b) || porTexto(a.maquina, b.maquina)).map(m => ({
    clave: m.maquina, etiqueta: m.maquina, detalle: m.cd, titulo: titulo(m), valores: [m.ofe], extra: [{ nombre: 'Horas ralentí', valor: horasLargo(m.ralenti) }],
  })), `${plural(maquinas.length, 'máquina', 'máquinas')} · OFE promedio · de mayor a menor${porPagina}`);

  const usoGerencia = new Map((w?.porGerencia ?? []).map(x => [claveTexto(x.gerencia), x.wip]));
  graficos.gerencia.convenciones = w ? [{ clase: 'ofe-sem-ok', nombre: 'Usabilidad WIP 99 % o más' }, { clase: 'ofe-sem-bajo', nombre: 'Menos de 99 %' }] : [];
  ponerCategorias(graficos.gerencia, [...r.porGerencia].sort((a, b) => b.ralenti - a.ralenti || porTexto(a.gerencia, b.gerencia)).map(g => {
    const uso = usoGerencia.get(claveTexto(g.gerencia));
    const nivel = nivelUso(uso);
    return {
      clave: g.gerencia, etiqueta: g.gerencia, titulo: `Gerencia ${g.gerencia}`, valores: [g.ralenti], clase: nivel ? `ofe-sem-${nivel}` : undefined,
      extra: w ? [{ nombre: 'Usabilidad WIP', valor: uso == null ? 'Sin datos' : pctUso(uso) }] : undefined,
    };
  }),
    `${plural(r.porGerencia.length, 'gerencia', 'gerencias')} · suma de horas · de mayor a menor`);
}

function pintar() {
  if (!filas || !opciones) return;
  const r = calcular(paraMotor());
  // El gráfico de la dimensión filtrada muestra todas sus barras (con las elegidas resaltadas), como el Power BI.
  const rTur = filtro.turnos.length ? calcular(paraMotor('turnos')) : r;
  const rMaq = filtro.maquinas.length ? calcular(paraMotor('maquinas')) : r;
  pintarResumen(r);
  pintarAviso(r);
  // Usabilidad WIP del mismo rango y los mismos CD (las tarjetas y el gráfico por gerencia del Power BI la usan).
  const w = filasWipOfe ? calcularWip(filasWipOfe, { desde: filtro.desde, hasta: filtro.hasta, cds: filtro.cds }) : null;
  pintarTarjetas(r, w);
  // La tabla por CD va antes que los gráficos: el de gerencia, a su lado, toma su alto.
  tablaCd.filas = r.porCd;
  tablaCd.total = r.tarjetas.filas ? r.tarjetas : null;
  porId('ofeTCdS').textContent = r.porCd.length ? `${plural(r.porCd.length, 'CD', 'CD')} · suma de horas y OFE promedio` : 'Suma de horas y OFE promedio';
  pintarTablaCd();
  pintarGraficos(r, rTur, rMaq, w);
  pintarDona(r.composicion, r.tarjetas.filas > 0);
}

let temporizador = 0;
/** Recalcula un instante después (varios clics seguidos se juntan); mientras tanto, lo anterior queda a media luz. */
function recalcular(espera = 140) {
  if (!filas) return;
  document.body.classList.add('t1-calculando');
  clearTimeout(temporizador);
  temporizador = window.setTimeout(() => requestAnimationFrame(() => setTimeout(() => {
    try { pintar(); } catch (error) {
      resumenTexto.dataset.tipo = 'error';
      resumenTexto.textContent = `No se pudo calcular: ${(error as Error).message}`;
    } finally { document.body.classList.remove('t1-calculando'); }
  }, 0)), espera);
}

// ---------- Carga de datos ----------

function pintarCarga() {
  const c = carga;
  const caja = porId('ofeArchivo');
  caja.classList.toggle('t1-archivo-falta', !c);
  const rango = c ? `del ${fecha(diaDeIso(c.desde))} al ${fecha(diaDeIso(c.hasta))}` : '';
  const quien = c ? `${c.usuario_nombre || 'sin nombre'} · ${formatoMomento.format(new Date(c.creado_en))}` : '';
  caja.querySelector('.t1-archivo-nombre')!.textContent = c ? c.archivo : 'Sin cargar';
  caja.querySelector('.t1-archivo-detalle')!.textContent = c ? `${plural(c.filas, 'fila', 'filas')} · ${rango}` : 'Sube Data FMS.xlsx para ver el uso de los montacargas.';
  caja.querySelector('.t1-archivo-quien')!.textContent = c ? `Subido por ${quien}` : '';
  const fuente = porId('ofeHeroDatos');
  if (!c) { fuente.textContent = 'Sin datos cargados'; return; }
  fuente.replaceChildren(crear('strong', undefined, 'Datos cargados: '), `${c.archivo} · ${plural(c.filas, 'fila', 'filas')} · ${rango} · subido por ${quien}`);
}

/** Copia de los datos en el navegador: se vuelven a descargar solo cuando alguien sube un archivo nuevo. */
const ALMACEN_OFE = 'ofe-datos';
async function pedirDatos(): Promise<ColumnasFms> {
  const ruta = '/api/ofe/datos/fms';
  const url = `${ruta}?v=${encodeURIComponent(carga?.creado_en ?? '')}`;
  const almacen = 'caches' in window ? await caches.open(ALMACEN_OFE).catch(() => null) : null;
  const guardada = await almacen?.match(url).catch(() => undefined);
  if (guardada) {
    try { return await guardada.json() as ColumnasFms; } catch { /* Copia dañada: se descarga de nuevo. */ }
  }
  const respuesta = await fetch(url);
  if (respuesta.status === 401) { location.replace('/'); throw new Error('La sesión terminó.'); }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    throw new Error(cuerpo.error || 'No se pudieron consultar los datos de Data FMS.');
  }
  if (almacen) {
    try {
      for (const vieja of await almacen.keys()) if (new URL(vieja.url).pathname === ruta) await almacen.delete(vieja);
      await almacen.put(url, respuesta.clone());
    } catch { /* Sin espacio para la copia: la página funciona igual. */ }
  }
  return respuesta.json() as Promise<ColumnasFms>;
}

function mostrarVacio(sinDatos: boolean) {
  porId('ofeVacio').hidden = !sinDatos;
  tablero.hidden = sinDatos;
  document.querySelector<HTMLElement>('.t1-kpis')!.hidden = sinDatos;
  // Sin datos no hay nada que filtrar: quedan solo el estado y el progreso de la carga.
  document.querySelector<HTMLElement>('.t1-filtros-fila')!.hidden = sinDatos;
  if (sinDatos) aviso.hidden = true;
}

/** Montacargas agregados o corregidos (null si no se pudieron consultar). Nunca falla: sin ellos la página usa la lista base. */
async function pedirMontacargas(): Promise<CambioMontacargas[] | null> {
  try {
    const respuesta = await fetch('/api/ofe/montacargas', { signal: AbortSignal.timeout(20_000) });
    if (respuesta.status === 401) { location.replace('/'); return null; }
    if (!respuesta.ok) return null;
    const cuerpo = await respuesta.json() as { cambios?: CambioMontacargas[] };
    return Array.isArray(cuerpo.cambios) ? cuerpo.cambios : null;
  } catch { return null; }
}
const AVISO_LISTA = 'No se pudieron consultar los montacargas agregados o corregidos: por ahora se usa la lista base.';
/** Guarda los cambios y arma la lista; con null (falló la consulta) se quedan los que había y se avisa. */
function ponerCambios(nuevos: CambioMontacargas[] | null) {
  listaFallo = nuevos === null;
  if (nuevos) cambios = nuevos;
  lista = listaMontacargas(cambios);
  for (const nota of [notaLista, porId('ofeMcNota')]) { nota.hidden = !listaFallo; nota.textContent = listaFallo ? AVISO_LISTA : ''; }
}
/** Filas de Data FMS con la lista de montacargas actual, y las opciones de los filtros que salen de ellas. */
function armarFilas() {
  if (!columnasFms) return;
  filas = filasFms(columnasFms, lista);
  opciones = opcionesOfe(filas);
  cdDeMaquina = new Map(opciones.maquinas.map(m => [m.maquina, m.cd]));
  memoria.clear();
  // Las elecciones que ya no existen en los datos se quitan.
  filtro.cds = filtro.cds.filter(v => opciones!.cds.includes(v));
  filtro.maquinas = filtro.maquinas.filter(v => cdDeMaquina.has(v));
  filtro.turnos = filtro.turnos.filter(v => opciones!.turnos.includes(v));
}
/** Tras agregar, corregir o quitar un montacargas: se recalcula y se repinta toda la página (sin descargar Data FMS otra vez). */
function aplicarLista() {
  if (!columnasFms) return;
  armarFilas();
  pintarFiltros();
  recalcular(0);
}

// ---------- Datos de WIP (usabilidades para las tarjetas y el gráfico por gerencia) ----------

/** Comparación de nombres sin mayúsculas ni tildes (gerencias de los dos archivos). */
const claveTexto = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
let filasWipOfe: FilaWip[] | null = null;
async function cargarWip() {
  try {
    const estado = await fetch('/api/wip/estado');
    if (!estado.ok) return;
    const c = (await estado.json().catch(() => ({}))).wip;
    if (!c) return;
    const ruta = '/api/wip/datos/wip';
    const url = `${ruta}?v=${encodeURIComponent(c.creado_en ?? '')}`;
    const almacen = 'caches' in window ? await caches.open('wip-datos').catch(() => null) : null;
    let datos: ColumnasWip | null = null;
    const guardada = await almacen?.match(url).catch(() => undefined);
    if (guardada) datos = await guardada.json().catch(() => null) as ColumnasWip | null;
    if (!datos) {
      const respuesta = await fetch(url);
      if (!respuesta.ok) return;
      if (almacen) {
        try {
          for (const vieja of await almacen.keys()) if (new URL(vieja.url).pathname === ruta) await almacen.delete(vieja);
          await almacen.put(url, respuesta.clone());
        } catch { /* Sin espacio para la copia: la página funciona igual. */ }
      }
      datos = await respuesta.json() as ColumnasWip;
    }
    filasWipOfe = filasWip(datos);
    if (filas) recalcular(0);
  } catch { /* Sin WIP, las tarjetas de usabilidad quedan sin dato y sin color. */ }
}

function cargar(): Promise<void> {
  cargando ??= (async () => {
    document.body.classList.add('t1-cargando');
    // La lista de montacargas se pide de una vez, mientras se consultan el estado y los datos.
    const cambiosPedidos = pedirMontacargas();
    try {
      const respuesta = await fetch('/api/ofe/estado');
      if (respuesta.status === 401) { location.replace('/'); return; }
      const estado = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(estado.error || 'No se pudo consultar OFE.');
      carga = estado.fms ?? null;
      pintarCarga();
      if (!carga) {
        filas = null;
        columnasFms = null;
        mostrarVacio(true);
        resumenTexto.dataset.tipo = '';
        resumenTexto.textContent = 'Aún no hay datos: sube Data FMS.xlsx.';
        ponerCambios(await cambiosPedidos);
        return;
      }
      resumenTexto.textContent = `Cargando ${plural(carga.filas, 'registro', 'registros')} de Data FMS…`;
      const [columnas, nuevos] = await Promise.all([pedirDatos(), cambiosPedidos]);
      ponerCambios(nuevos);
      columnasFms = columnas;
      armarFilas();
      if (rangoPorDefecto || !filtro.desde) rangoInicial();
      else ponerDentro();
      llenarMeses();
      llenarTurnos();
      mostrarVacio(false);
      pintarFiltros();
      recalcular(0);
    } catch (error) {
      resumenTexto.dataset.tipo = 'error';
      resumenTexto.textContent = error instanceof TypeError ? SIN_CONEXION : (error as Error).message;
    } finally {
      document.body.classList.remove('t1-cargando');
      cargando = null;
    }
  })();
  return cargando;
}
/** Tras una carga nueva, el rango elegido se ajusta a las fechas que existen. */
function ponerDentro() {
  if (!opciones || opciones.desde === null || opciones.hasta === null) return;
  filtro.desde = Math.min(opciones.hasta, Math.max(opciones.desde, filtro.desde));
  filtro.hasta = Math.min(opciones.hasta, Math.max(filtro.desde, filtro.hasta));
}

// Subir Data FMS.xlsx: se lee en segundo plano (cargas-worker), se sube comprimido y se recarga la página.
const entradaArchivo = porId<HTMLInputElement>('ofeArchivoEntrada');
const progreso = porId('ofeProgreso');
const progresoTexto = porId('ofeProgresoTexto');
const botonesSubir = ['ofeSubir', 'ofeSubirAbajo', 'ofeVacioSubir'].map(id => porId<HTMLButtonElement>(id));
let subiendo = false;

function avance(texto: string, tipo: '' | 'ok' | 'error' = '') {
  progreso.hidden = false;
  progreso.dataset.tipo = tipo;
  progresoTexto.textContent = texto;
}
function leerEnSegundoPlano(file: File): Promise<RespuestaWorkerCargas> {
  return new Promise(resolver => {
    const trabajador = new Worker('/js/cargas-worker.js', { type: 'module' });
    trabajador.onmessage = (evento: MessageEvent<RespuestaWorkerCargas>) => { trabajador.terminate(); resolver(evento.data); };
    trabajador.onerror = () => { trabajador.terminate(); resolver({ error: 'No se pudo leer el archivo. Verifica que sea el Excel de Data FMS y vuelve a intentar.' }); };
    trabajador.postMessage({ file, tipo: 'fms' });
  });
}

async function subir(archivo: File | undefined) {
  if (subiendo || !archivo) return;
  subiendo = true;
  botonesSubir.forEach(b => { b.disabled = true; });
  let listo = '';
  let problema = '';
  try {
    avance(`Leyendo ${archivo.name}…`);
    const lectura = await leerEnSegundoPlano(archivo);
    if (lectura.error || !lectura.gzip) problema = lectura.error ?? 'no se pudo leer.';
    else {
      avance(`Subiendo ${archivo.name} · ${plural(lectura.filas ?? 0, 'fila', 'filas')} de Data FMS…`);
      const respuesta = await fetch('/api/ofe/cargar/fms', {
        method: 'POST', body: lectura.gzip,
        headers: { 'Content-Type': 'application/octet-stream', 'x-archivo': encodeURIComponent(archivo.name) },
      });
      if (respuesta.status === 401) { location.replace('/'); return; }
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) problema = cuerpo.error || 'no se pudo guardar.';
      else {
        const omitidas = lectura.omitidas?.length ?? 0;
        listo = `${archivo.name}: ${plural(lectura.filas ?? 0, 'fila', 'filas')}${lectura.desde != null && lectura.hasta != null ? `, del ${fecha(lectura.desde)} al ${fecha(lectura.hasta)}` : ''}`
          + (omitidas ? ` · ${omitidas >= 50 ? '50 o más filas' : plural(omitidas, 'fila', 'filas')} sin fecha u horas válidas se ${omitidas === 1 ? 'omitió' : 'omitieron'} (fila ${lectura.omitidas![0].fila}: ${lectura.omitidas![0].motivo.toLowerCase()})` : '');
        avance('Listo. Actualizando la página con los datos nuevos…');
        await cargar();
      }
    }
  } catch (error) {
    problema = error instanceof TypeError ? SIN_CONEXION : (error as Error).message;
  } finally {
    subiendo = false;
    botonesSubir.forEach(b => { b.disabled = false; });
    entradaArchivo.value = '';
  }
  if (problema) avance(`No se cargó ${archivo.name}: ${problema}`, 'error');
  else if (listo) avance(`Datos actualizados. ${listo}.`, 'ok');
}
for (const b of botonesSubir) b.addEventListener('click', () => entradaArchivo.click());
entradaArchivo.addEventListener('change', () => void subir(entradaArchivo.files?.[0]));

const firmaCambios = (l: readonly CambioMontacargas[]) => l.map(c => `${claveChasis(c.chasis)}|${c.cd}|${c.placa}|${c.actualizado_en ?? ''}`).sort().join('\n');
/** Si alguien sube un archivo o cambia la lista de montacargas mientras la página está abierta, se toma sin recargar. */
async function revisarCargasNuevas() {
  if (cargando || document.hidden) return;
  try {
    const respuesta = await fetch('/api/ofe/estado');
    if (!respuesta.ok) return;
    const estado = await respuesta.json() as { fms?: Carga | null };
    if ((estado.fms?.creado_en ?? null) !== (carga?.creado_en ?? null) && !cargando) { await cargar(); return; }
    // La lista solo se toma si se pudo consultar (un fallo pasajero no cambia nada) y algo cambió.
    const nuevos = await pedirMontacargas();
    if (nuevos && !cargando && (listaFallo || firmaCambios(nuevos) !== firmaCambios(cambios))) {
      ponerCambios(nuevos);
      aplicarLista();
      if (dialogo.open) pintarListaMc();
    }
  } catch { /* Sin conexión: se intenta en la próxima revisión. */ }
}
setInterval(() => void revisarCargasNuevas(), 120_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void revisarCargasNuevas(); });

// ---------- Lista de montacargas: ver, agregar, corregir y quitar ----------
// La ventana tiene dos pasos: la tabla (con buscador y páginas) y el formulario. Lo que se guarda va al servidor y la
// página se recalcula al instante con la lista nueva. Los montacargas de la lista base no se quitan: solo se corrigen.

const notaLista = porId('ofeNotaLista');
const dialogo = porId<HTMLDialogElement>('ofeMc');
const mcPasoLista = porId('ofeMcPasoLista');
const mcFilas = porId<HTMLTableSectionElement>('ofeMcFilas');
const mcBuscar = porId<HTMLInputElement>('ofeMcBuscar');
const mcPaginas = porId('ofeMcPaginas');
const mcEstado = porId('ofeMcEstado');
const mcForm = porId<HTMLFormElement>('ofeMcForm');
const campoChasis = porId<HTMLInputElement>('ofeMcChasis');
const campoCd = porId<HTMLSelectElement>('ofeMcCd');
const campoPlaca = porId<HTMLInputElement>('ofeMcPlaca');
const botonAgregar = porId<HTMLButtonElement>('ofeMcAgregar');
const botonCerrar = porId<HTMLButtonElement>('ofeMcCerrar');
const botonVolver = porId<HTMLButtonElement>('ofeMcVolver');
const botonGuardar = porId<HTMLButtonElement>('ofeMcGuardar');
campoCd.append(...CDS_FMS.map(cd => new Option(cd, cd)));
const CAMPOS_MC: Record<string, HTMLInputElement | HTMLSelectElement> = { chasis: campoChasis, cd: campoCd, placa: campoPlaca };

const mc = {
  pagina: 0,
  /** Chasis (clave) de la fila que pide confirmar "Quitar" o "Deshacer corrección". */
  confirmando: null as string | null,
  /** Chasis (clave) recién guardado: su fila se resalta. */
  resaltar: null as string | null,
  /** Montacargas que se edita (null: uno nuevo). */
  editando: null as MontacargasDeLista | null,
  /** El formulario se abrió desde el aviso: "Cancelar" cierra la ventana en vez de volver a la tabla. */
  desdeAviso: false,
  ocupado: false,
  /** Filas por página: las que caben sin que la ventana se desplace (ver ajustarPorPagina). */
  porPagina: 10,
};
const celular = matchMedia('(max-width: 700px)');
/** En celular cada montacargas es una tarjeta: caben menos. */
const porPaginaMaxima = () => (celular.matches ? 5 : 10);
const formatoDia = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Bogota' });
const ORDEN_ORIGEN: Record<MontacargasDeLista['origen'], number> = { agregado: 0, corregido: 1, lista: 2 };
const deChasis = (chasis: string) => lista.find(m => claveChasis(m.chasis) === claveChasis(chasis)) ?? null;

function estadoMc(texto: string, tipo: '' | 'ok' | 'error' = '') {
  mcEstado.dataset.tipo = tipo;
  mcEstado.textContent = texto;
}

/** Primero lo agregado y corregido (lo más reciente arriba); luego la lista base por CD y placa. */
function listaVisible(): MontacargasDeLista[] {
  const q = normalizar(mcBuscar.value);
  return lista
    .filter(m => !q || normalizar(`${m.chasis} ${m.placa} ${m.cd}`).includes(q))
    .sort((a, b) => ORDEN_ORIGEN[a.origen] - ORDEN_ORIGEN[b.origen]
      || (b.cambio?.actualizado_en ?? '').localeCompare(a.cambio?.actualizado_en ?? '')
      || porTexto(a.cd, b.cd) || porTexto(a.placa, b.placa));
}

/** "Agregado por X" (o "Corregido por X", "Lista base"); debajo, la fecha y, si se corrigió, los valores de la lista base. */
function textoOrigen(m: MontacargasDeLista): { sello: string; detalle: string } {
  if (m.origen === 'lista') return { sello: 'Lista base', detalle: '' };
  const momento = m.cambio?.actualizado_en ? new Date(m.cambio.actualizado_en) : null;
  const partes = momento && !Number.isNaN(momento.getTime()) ? [formatoDia.format(momento)] : [];
  if (m.origen === 'corregido' && m.original) partes.push(`antes: ${m.original.cd}, placa ${m.original.placa}`);
  return { sello: `${m.origen === 'agregado' ? 'Agregado' : 'Corregido'} por ${m.cambio?.usuario_nombre || 'sin nombre'}`, detalle: mayuscula(partes.join(' · ')) };
}

function botonMc(texto: string, clase: string, etiqueta: string, trazos: string | null, accion: () => void): HTMLButtonElement {
  const b = crear('button', `fm-accion ${clase}`);
  b.type = 'button';
  b.setAttribute('aria-label', etiqueta);
  if (trazos) b.append(icono(trazos));
  b.append(texto);
  b.addEventListener('click', accion);
  return b;
}
const ICONO_EDITAR = 'M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16zM14 6l4 4';
const ICONO_QUITAR = 'M5 7h14M10 11v6M14 11v6M6.5 7l1 13h9l1-13M9.5 7V4.5h5V7';
const ICONO_DESHACER = 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3';

function accionesDe(m: MontacargasDeLista): HTMLElement[] {
  const clave = claveChasis(m.chasis);
  const agregado = m.origen === 'agregado';
  if (mc.confirmando === clave) {
    // Confirmación en la misma fila (sin ventanas del navegador).
    return [
      crear('span', 'ofe-mc-pregunta', agregado ? '¿Quitar de la lista?' : '¿Volver a la lista base?'),
      botonMc(agregado ? 'Sí, quitar' : 'Sí, deshacer', 'eliminar ofe-mc-si', `${agregado ? 'Sí, quitar' : 'Sí, deshacer la corrección de'} ${m.chasis}`, null, () => void quitarMontacargas(m)),
      botonMc('No', 'ofe-mc-no', 'No, dejarlo como está', null, () => { mc.confirmando = null; pintarListaMc(); enfocarFila(clave, agregado ? '.ofe-mc-quitar' : '.ofe-mc-deshacer'); }),
    ];
  }
  const acciones = [botonMc('Editar', 'editar ofe-mc-editar', `Editar el montacargas ${m.chasis}`, ICONO_EDITAR, () => abrirFormulario(m))];
  if (m.origen !== 'lista') {
    acciones.push(botonMc(agregado ? 'Quitar' : 'Deshacer corrección', `eliminar ${agregado ? 'ofe-mc-quitar' : 'ofe-mc-deshacer'}`,
      agregado ? `Quitar el montacargas ${m.chasis} de la lista` : `Deshacer la corrección del montacargas ${m.chasis}`, agregado ? ICONO_QUITAR : ICONO_DESHACER,
      () => { mc.confirmando = clave; pintarListaMc(); enfocarFila(clave, '.ofe-mc-no'); }));
  }
  return acciones;
}
function enfocarFila(clave: string, selector: string) {
  const fila = [...mcFilas.rows].find(tr => tr.dataset.chasis === clave);
  (fila?.querySelector<HTMLElement>(selector) ?? mcBuscar).focus();
}

/** Sin barras de desplazamiento: se baja el número de filas por página hasta que la ventana quepa en la pantalla (mínimo 3).
 *  Se mide con el recuadro de estado a la vista, para que un mensaje después de guardar no la haga desplazar. */
function ajustarPorPagina() {
  if (!dialogo.open || mcPasoLista.hidden) return;
  const cuerpo = dialogo.querySelector<HTMLElement>('.fm-dialogo-cuerpo')!;
  const sinEstado = !mcEstado.textContent;
  if (sinEstado) mcEstado.textContent = ' ';
  const primera = mc.pagina * mc.porPagina;
  for (mc.porPagina = porPaginaMaxima(); ; mc.porPagina--) {
    mc.pagina = Math.floor(primera / mc.porPagina);
    pintarListaMc();
    if (mc.porPagina <= 3 || cuerpo.scrollHeight <= cuerpo.clientHeight + 1) break;
  }
  if (sinEstado) mcEstado.textContent = '';
  // La fila recién guardada sigue a la vista aunque cambie el tamaño de las páginas.
  const posicion = mc.resaltar ? listaVisible().findIndex(m => claveChasis(m.chasis) === mc.resaltar) : -1;
  if (posicion >= 0 && Math.floor(posicion / mc.porPagina) !== mc.pagina) { mc.pagina = Math.floor(posicion / mc.porPagina); pintarListaMc(); }
}

function pintarListaMc() {
  const visibles = listaVisible();
  const porPagina = mc.porPagina;
  const paginas = Math.max(1, Math.ceil(visibles.length / porPagina));
  mc.pagina = Math.max(0, Math.min(mc.pagina, paginas - 1));
  const inicio = mc.pagina * porPagina;
  const q = mcBuscar.value.trim();
  const agregados = lista.filter(m => m.origen === 'agregado').length;
  const corregidos = lista.filter(m => m.origen === 'corregido').length;
  porId('ofeMcCuenta').textContent = q
    ? `${cifra(visibles.length)} de ${plural(lista.length, 'montacargas', 'montacargas')}`
    : `${plural(lista.length, 'montacargas', 'montacargas')} · ${plural(agregados, 'agregado', 'agregados')} · ${plural(corregidos, 'corregido', 'corregidos')}`;
  if (!visibles.length) {
    const tr = crear('tr', 'ofe-mc-vacia');
    const td = crear('td', undefined, `Ningún montacargas coincide con «${q}».`);
    td.colSpan = 5;
    tr.append(td);
    mcFilas.replaceChildren(tr);
  } else {
    mcFilas.replaceChildren(...visibles.slice(inicio, inicio + porPagina).map((m, i) => {
      const clave = claveChasis(m.chasis);
      const tr = crear('tr', `ofe-mc-fila${clave === mc.resaltar ? ' ofe-mc-resaltada' : ''}`);
      tr.dataset.chasis = clave;
      tr.style.setProperty('--f', String(i));
      const chasis = crear('th', 'ofe-mc-chasis', m.chasis);
      chasis.scope = 'row';
      const origen = textoOrigen(m);
      const tdOrigen = crear('td', `ofe-mc-origen ofe-mc-origen-${m.origen}`);
      tdOrigen.append(crear('span', `ofe-mc-sello ofe-mc-${m.origen}`, origen.sello));
      if (origen.detalle) tdOrigen.append(crear('small', undefined, origen.detalle));
      const tdAcciones = crear('td', 'ofe-mc-acciones');
      tdAcciones.append(...accionesDe(m));
      tr.append(chasis, crear('td', 'ofe-mc-cd', m.cd), crear('td', 'ofe-mc-placa', m.placa), tdOrigen, tdAcciones);
      return tr;
    }));
  }
  mcPaginas.replaceChildren(...(paginas > 1 ? [crearPaginas('la lista de montacargas', visibles.length, mc.pagina, porPagina, () => mcPaginas, p => { mc.pagina = p; mc.confirmando = null; pintarListaMc(); })] : []));
}

function mostrarPaso(paso: 'lista' | 'formulario') {
  const enLista = paso === 'lista';
  mcPasoLista.hidden = !enLista;
  mcForm.hidden = enLista;
  botonCerrar.hidden = botonAgregar.hidden = !enLista;
  botonVolver.hidden = botonGuardar.hidden = enLista;
}

/** Abre la ventana: en la tabla, o (desde el aviso) directo en el formulario con el chasis ya escrito. */
function abrirMontacargas(chasis?: string) {
  mc.confirmando = null;
  mc.resaltar = null;
  estadoMc('');
  // Si la lista no se pudo consultar al abrir la página, se intenta de nuevo.
  if (listaFallo) void pedirMontacargas().then(nuevos => { if (nuevos) { ponerCambios(nuevos); aplicarLista(); if (dialogo.open && !mcPasoLista.hidden) pintarListaMc(); } });
  if (!dialogo.open) dialogo.showModal();
  if (chasis) { abrirFormulario(deChasis(chasis), chasis, true); return; }
  mostrarPaso('lista');
  ajustarPorPagina();
  mcBuscar.focus();
}

function limpiarErrores() {
  for (const campo of Object.keys(CAMPOS_MC)) marcarCampo(campo, '');
}
function marcarCampo(campo: string, error: string) {
  const pregunta = mcForm.querySelector<HTMLElement>(`.fm-pregunta[data-campo="${campo}"]`)!;
  pregunta.classList.toggle('fm-invalida', !!error);
  pregunta.querySelector(':is(input,select)')!.setAttribute('aria-invalid', String(!!error));
  pregunta.querySelector('.fm-error')!.textContent = error;
}

/** Registros de un chasis en Data FMS (todo el archivo y el rango elegido). */
function registrosDe(chasis: string): { total: number; enRango: number } {
  const clave = claveChasis(chasis);
  let total = 0, enRango = 0;
  for (const f of filas ?? []) {
    if (claveChasis(f.forklift) !== clave) continue;
    total++;
    if (f.fecha >= filtro.desde && f.fecha <= filtro.hasta) enRango++;
  }
  return { total, enRango };
}
/** Debajo del chasis: si ya está en la lista y cuántos registros tiene (así se nota si está mal escrito). */
function pintarInfoChasis() {
  const info = porId('ofeMcChasisInfo');
  const chasis = campoChasis.value.trim();
  if (chasis.length < 3) { info.textContent = ''; return; }
  const partes: string[] = [];
  const existente = deChasis(chasis);
  if (!mc.editando && existente) partes.push(`Ya está en la lista (CD ${existente.cd}, placa ${existente.placa}): al guardar se cambia.`);
  if (filas) {
    const { total, enRango } = registrosDe(chasis);
    partes.push(total ? `Tiene ${plural(total, 'registro', 'registros')} en Data FMS (${cifra(enRango)} en el rango elegido).` : 'No aparece en el Data FMS cargado: revisa que esté escrito igual que en la columna Forklift.');
  }
  info.textContent = partes.join(' ');
}
campoChasis.addEventListener('input', pintarInfoChasis);

function abrirFormulario(m: MontacargasDeLista | null, chasis = '', desdeAviso = false) {
  mc.editando = m;
  mc.desdeAviso = desdeAviso;
  mc.confirmando = null;
  estadoMc('');
  limpiarErrores();
  campoChasis.value = m?.chasis ?? chasis;
  // El chasis no se cambia al editar ni cuando viene del aviso (ya está escrito como en Data FMS).
  campoChasis.readOnly = !!m || !!chasis;
  campoCd.value = m ? (CDS_FMS.find(cd => normalizar(cd) === normalizar(m.cd)) ?? '') : '';
  campoPlaca.value = m?.placa ?? '';
  porId('ofeMcFormTitulo').textContent = !m ? 'Agregar montacargas' : m.origen === 'lista' ? 'Corregir montacargas' : m.origen === 'corregido' ? 'Editar corrección' : 'Editar montacargas agregado';
  porId('ofeMcFormAyuda').textContent = !m
    ? 'Escribe el chasis tal como sale en la columna Forklift de Data FMS, y elige su CD y su placa o número de máquina.'
    : m.origen === 'agregado' ? 'Cambia el CD o la placa de este montacargas.'
      : `En la lista base: CD ${m.original?.cd ?? m.cd} · placa ${m.original?.placa ?? m.placa}. Con «Deshacer corrección» siempre se puede volver a esos valores.`;
  pintarInfoChasis();
  mostrarPaso('formulario');
  (campoChasis.readOnly ? campoCd : campoChasis).focus();
}

function volverALista() {
  mc.editando = null;
  mostrarPaso('lista');
  ajustarPorPagina();
}

function ocupadoMc(si: boolean) {
  mc.ocupado = si;
  dialogo.toggleAttribute('data-ocupado', si);
  for (const b of dialogo.querySelectorAll<HTMLButtonElement>('.fm-dialogo-acciones button, .ofe-mc-acciones button')) b.disabled = si;
}

/** Respuesta del servidor: 401 vuelve al inicio de sesión; si no, el cuerpo (o un error en español). */
async function pedirMc(url: string, init: RequestInit): Promise<{ ok: boolean; cuerpo: { cambio?: CambioMontacargas; error?: string } } | null> {
  const respuesta = await fetch(url, init);
  if (respuesta.status === 401) { location.replace('/'); return null; }
  return { ok: respuesta.ok, cuerpo: await respuesta.json().catch(() => ({})) };
}

/** Después de guardar o quitar: la lista y la página se ponen al día; la fila tocada queda a la vista y resaltada. */
function despuesDeCambio(nuevos: CambioMontacargas[], chasis: string, mensaje: string) {
  ponerCambios(nuevos);
  aplicarLista();
  const clave = claveChasis(chasis);
  mc.resaltar = clave;
  mc.confirmando = null;
  mcBuscar.value = '';
  const posicion = listaVisible().findIndex(m => claveChasis(m.chasis) === clave);
  mc.pagina = posicion < 0 ? 0 : Math.floor(posicion / mc.porPagina);
  volverALista();
  estadoMc(mensaje, 'ok');
  anuncio.textContent = mensaje;
}

mcForm.addEventListener('submit', async evento => {
  evento.preventDefault();
  if (mc.ocupado) return;
  limpiarErrores();
  estadoMc('');
  const revision = revisarMontacargas({ chasis: campoChasis.value, cd: campoCd.value, placa: campoPlaca.value });
  if ('error' in revision) {
    // El mensaje del motor dice de qué campo se trata.
    const campo = /chasis/i.test(revision.error) ? 'chasis' : /\bCD\b/.test(revision.error) ? 'cd' : 'placa';
    marcarCampo(campo, revision.error);
    CAMPOS_MC[campo].focus();
    return;
  }
  const { chasis, cd, placa } = revision.montacargas;
  const antes = deChasis(chasis);
  ocupadoMc(true);
  estadoMc('Guardando…');
  try {
    const r = await pedirMc('/api/ofe/montacargas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chasis, cd, placa }) });
    if (!r) return;
    const cambio = r.cuerpo.cambio;
    if (!r.ok || !cambio) { estadoMc(r.cuerpo.error || 'No se pudo guardar el montacargas. Reintenta en un momento.', 'error'); return; }
    const nuevos = [cambio, ...cambios.filter(c => claveChasis(c.chasis) !== claveChasis(cambio.chasis))];
    const { total } = registrosDe(cambio.chasis);
    const mensaje = !antes
      ? `Montacargas ${cambio.chasis} agregado a ${cambio.cd}${total ? ': sus registros ya cuentan.' : '. Todavía no tiene registros en Data FMS.'}`
      : antes.origen === 'agregado' ? `Montacargas ${cambio.chasis} actualizado: CD ${cambio.cd}, placa ${cambio.placa}.`
        : `Montacargas ${cambio.chasis} corregido: CD ${cambio.cd}, placa ${cambio.placa}.`;
    despuesDeCambio(nuevos, cambio.chasis, mensaje);
    enfocarFila(claveChasis(cambio.chasis), '.ofe-mc-editar');
  } catch (error) {
    estadoMc(error instanceof TypeError ? SIN_CONEXION : (error as Error).message, 'error');
  } finally { ocupadoMc(false); }
});

async function quitarMontacargas(m: MontacargasDeLista) {
  if (mc.ocupado) return;
  const clave = claveChasis(m.chasis);
  ocupadoMc(true);
  estadoMc(m.origen === 'agregado' ? 'Quitando…' : 'Deshaciendo la corrección…');
  try {
    const r = await pedirMc(`/api/ofe/montacargas?chasis=${encodeURIComponent(m.chasis)}`, { method: 'DELETE' });
    if (!r) return;
    if (!r.ok) { estadoMc(r.cuerpo.error || 'No se pudo quitar el montacargas. Reintenta en un momento.', 'error'); return; }
    const nuevos = cambios.filter(c => claveChasis(c.chasis) !== clave);
    const mensaje = m.origen === 'agregado'
      ? `Montacargas ${m.chasis} quitado de la lista: sus registros ya no cuentan.`
      : `Se deshizo la corrección de ${m.chasis}: vuelve a CD ${m.original?.cd ?? ''}, placa ${m.original?.placa ?? ''}.`;
    despuesDeCambio(nuevos, m.chasis, mensaje);
    // Un agregado desaparece de la tabla (el foco va al buscador); uno corregido queda como de la lista base.
    enfocarFila(clave, '.ofe-mc-editar');
  } catch (error) {
    estadoMc(error instanceof TypeError ? SIN_CONEXION : (error as Error).message, 'error');
  } finally { ocupadoMc(false); }
}

porId('ofeAbrirMontacargas').addEventListener('click', () => abrirMontacargas());
botonAgregar.addEventListener('click', () => abrirFormulario(null));
botonVolver.addEventListener('click', () => { if (mc.desdeAviso) dialogo.close(); else { volverALista(); botonAgregar.focus(); } });
for (const b of [botonCerrar, porId<HTMLButtonElement>('ofeMcCerrarX')]) b.addEventListener('click', () => dialogo.close());
mcBuscar.addEventListener('input', () => { mc.pagina = 0; mc.confirmando = null; mc.resaltar = null; pintarListaMc(); });
// Escape: primero cancela la confirmación o el formulario; con la tabla a la vista, cierra.
dialogo.addEventListener('cancel', evento => {
  if (mc.ocupado) { evento.preventDefault(); return; }
  if (mc.confirmando) { evento.preventDefault(); const clave = mc.confirmando; mc.confirmando = null; pintarListaMc(); enfocarFila(clave, '.ofe-mc-quitar, .ofe-mc-deshacer'); return; }
  if (!mcForm.hidden && !mc.desdeAviso) { evento.preventDefault(); volverALista(); botonAgregar.focus(); }
});
dialogo.addEventListener('close', () => { mc.confirmando = null; mc.editando = null; mc.resaltar = null; });
// Al cambiar el tamaño de la ventana del navegador, se vuelve a calcular cuántas filas caben.
let cuadroMc = 0;
addEventListener('resize', () => { cancelAnimationFrame(cuadroMc); cuadroMc = requestAnimationFrame(ajustarPorPagina); });

void cargar();
void cargarWip();

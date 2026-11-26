// Módulo Seguimiento T1: réplica de la página "Seguimiento T1" del Power BI "Seguimiento ATCT".
// Trae del servidor la última carga de ATCT.xlsx y de ESPERA.xlsx (en columnas) y calcula TODO en el navegador con
// src/shared/t1.ts (las reglas del Power BI viven allí; aquí solo se dibuja). Al cambiar un filtro se recalcula.
// Muestra 4 tarjetas, 10 gráficos en SVG propio (cada uno con "Ver tabla"), 2 mapas de calor, 4 tablas con páginas,
// la descarga de exclusiones en Excel y la carga de archivos nuevos. Tema, usuario y salida: modulos.ts.
import * as XLSX from 'xlsx';
import { porId } from './dom';
import {
  calcularT1, diaDeIso, fechaDeDia, filasAtct, filasEspera, horasATexto, isoDeDia, opcionesT1,
  DIAS_SEMANA, MESES, UMBRAL_EXCLUSION_ATENCION, UMBRAL_EXCLUSION_ESPERA,
} from '../shared/t1';
import type { ColumnasAtct, ColumnasEspera, DatosT1, FilaAtct, FilaEspera, FiltrosT1, Mapa, OpcionesT1, ResultadoT1, TipoCarga, Turno } from '../shared/t1';
import type { RespuestaWorkerT1 } from './t1-worker';

const SVG = 'http://www.w3.org/2000/svg';
const SIN_CONEXION = 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');
const NOMBRE_TIPO: Record<TipoCarga, string> = { atct: 'ATCT', espera: 'ESPERA' };

// ---------- Formatos ----------

const cifra = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
const formatoHoras = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Horas con 2 decimales ("1,38"), o "—" si no hay dato. */
const horas = (n: number | null) => (n === null || !Number.isFinite(n) ? '—' : formatoHoras.format(n));
/** "1,38 h · 1:23" para la ventanita y las tablas. */
const horasLargo = (n: number | null) => (n === null ? 'Sin datos' : `${horas(n)} h · ${horasATexto(n)}`);
/** Minutos como en la columna hh:mm del Excel ("01:25"). */
const hhmm = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
const formatoFecha = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const fecha = (dia: number) => formatoFecha.format(fechaDeDia(dia));
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIA_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** "2 nov". */
const diaCorto = (dia: number) => { const f = fechaDeDia(dia); return `${f.getUTCDate()} ${MES_CORTO[f.getUTCMonth()]}`; };
/** "Lunes, 02/11/2026". */
const fechaLarga = (dia: number) => `${mayuscula(DIAS_SEMANA[fechaDeDia(dia).getUTCDay()])}, ${fecha(dia)}`;
/** "Noviembre 2026" de "2026-11". */
const nombreMes = (mes: string) => `${mayuscula(MESES[Number(mes.slice(5, 7)) - 1])} ${mes.slice(0, 4)}`;
const plural = (n: number, uno: string, varios: string) => `${cifra(n)} ${n === 1 ? uno : varios}`;
const mesDeDia = (dia: number) => isoDeDia(dia).slice(0, 7);
/** Último día del mes "AAAA-MM" (día de Excel). */
function finDeMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number);
  return diaDeIso(`${mes}-01`) + new Date(Date.UTC(a, m, 0)).getUTCDate() - 1;
}
const formatoMomento = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });

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

type Dimension = 'cds' | 'gerencias' | 'turnos';
interface Filtro { desde: number; hasta: number; cds: string[]; gerencias: string[]; semanas: number[]; diasSemana: number[]; turnos: Turno[] }
interface Carga { archivo: string; filas: number; desde: string; hasta: string; usuario_nombre: string | null; creado_en: string }
type Cargas = Record<TipoCarga, Carga | null>;

let datos: DatosT1 | null = null;
let opciones: OpcionesT1 | null = null;
let cargas: Cargas = { atct: null, espera: null };
let resultado: ResultadoT1 | null = null;
/** Primer y último día de cada semana (para nombrarlas en el filtro y en el gráfico). */
let diasDeSemana = new Map<number, [number, number]>();
const filtro: Filtro = { desde: 0, hasta: 0, cds: [], gerencias: [], semanas: [], diasSemana: [], turnos: [] };
/** Mientras el usuario no toque las fechas, una carga nueva vuelve a poner el mes de la última fecha. */
let rangoPorDefecto = true;
let cargando: Promise<void> | null = null;

const anuncio = porId('t1Anuncio');
const resumenTexto = porId('t1Resumen');
const tablero = porId('t1Tablero');
const campoDesde = porId<HTMLInputElement>('t1Desde');
const campoHasta = porId<HTMLInputElement>('t1Hasta');
const campoMes = porId<HTMLSelectElement>('t1Mes');

/** Filtros para el motor; "sin" deja fuera una dimensión (el gráfico de esa dimensión muestra todas sus barras y resalta las elegidas). */
function paraMotor(sin?: Dimension): FiltrosT1 {
  return {
    desde: filtro.desde, hasta: filtro.hasta,
    cds: sin === 'cds' ? [] : filtro.cds, gerencias: sin === 'gerencias' ? [] : filtro.gerencias,
    semanas: filtro.semanas, diasSemana: filtro.diasSemana, turnos: sin === 'turnos' ? [] : filtro.turnos,
  };
}
const memoria = new Map<string, ResultadoT1>();
function calcular(f: FiltrosT1): ResultadoT1 {
  const clave = JSON.stringify(f);
  let r = memoria.get(clave);
  if (!r) {
    r = calcularT1(datos!, f);
    if (memoria.size > 16) memoria.delete(memoria.keys().next().value!);
    memoria.set(clave, r);
  }
  return r;
}

// ---------- Ventanita de detalle (puntero o teclado) ----------

const tip = porId('t1Tip');
interface FilaTip { nombre: string; valor: string; clase?: string; fuerte?: boolean }

function mostrarTip(titulo: string, filas: readonly FilaTip[], x: number, y: number, pista?: string) {
  const lista = crear('dl', 't1-tip-filas');
  for (const f of filas) {
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

interface Serie { nombre: string; clase: string }
const ATENCION: Serie = { nombre: 'Atención', clase: 't1-c-at' };
const ESPERA: Serie = { nombre: 'Espera', clase: 't1-c-es' };
interface Categoria {
  clave: string; etiqueta: string; titulo: string; valores: (number | null)[];
  /** Posición en el eje (días de Excel) para las líneas por fecha. */
  x?: number;
  /** Total que manda el motor (FTCT) cuando las partes van apiladas. */
  total?: number | null;
}
interface Grafico {
  caja: HTMLElement; subtitulo: HTMLElement | null; nombre: string; forma: 'linea' | 'barras' | 'columnas';
  series: Serie[]; apilado: boolean; categorias: Categoria[]; encabezado: string; totalNombre: string;
  /** Si tiene dimensión, un clic en una barra filtra la página por ella. */
  dimension: Dimension | null; seleccion: Set<string>;
  vacio: string; enTabla: boolean; ancho: number; foco: number;
}
function nuevoGrafico(caja: string, subtitulo: string | null, nombre: string, forma: Grafico['forma'], series: Serie[], encabezado: string, extra: Partial<Grafico> = {}): Grafico {
  return {
    caja: porId(caja), subtitulo: subtitulo ? porId(subtitulo) : null, nombre, forma, series, apilado: false, categorias: [], encabezado, totalNombre: 'Total',
    dimension: null, seleccion: new Set(), vacio: 'Sin registros con estos filtros.', enTabla: false, ancho: 0, foco: 0, ...extra,
  };
}
const graficos: Record<string, Grafico> = {
  diaria: nuevoGrafico('t1GDiaria', 't1GDiariaS', 'Tendencia diaria de atención y espera', 'linea', [ATENCION, ESPERA], 'Fecha'),
  mensual: nuevoGrafico('t1GMensual', null, 'Tendencia mensual de atención y espera', 'linea', [ATENCION, ESPERA], 'Mes'),
  cdAtencion: nuevoGrafico('t1GCdAt', 't1GCdAtS', 'Tiempo de atención por CD', 'barras', [ATENCION], 'CD', { dimension: 'cds' }),
  cdEspera: nuevoGrafico('t1GCdEs', 't1GCdEsS', 'Tiempo de espera por CD', 'barras', [ESPERA], 'CD', { dimension: 'cds' }),
  cdFtct: nuevoGrafico('t1GCdFt', 't1GCdFtS', 'FTCT por CD', 'barras', [ATENCION, ESPERA], 'CD', { dimension: 'cds', apilado: true, totalNombre: 'FTCT' }),
  diaSemana: nuevoGrafico('t1GDiaSem', 't1GDiaSemS', 'Atención y espera promedio por día de semana', 'columnas', [ATENCION, ESPERA], 'Día'),
  turno: nuevoGrafico('t1GTurno', null, 'Atención y espera promedio por turno', 'columnas', [ATENCION, ESPERA], 'Turno', { dimension: 'turnos' }),
  gerencia: nuevoGrafico('t1GGer', 't1GGerS', 'Tiempo de atención por gerencia', 'barras', [ATENCION], 'Gerencia', { dimension: 'gerencias' }),
  ol: nuevoGrafico('t1GOl', null, 'Tiempo de atención por OL', 'columnas', [ATENCION], 'OL'),
  semana: nuevoGrafico('t1GSem', 't1GSemS', 'Tendencia semanal de atención', 'columnas', [ATENCION], 'Semana'),
};

/** Marcas "redondas" del eje de horas (0; 0,5; 1; 1,5…): unas 4 o 5. */
function marcasEje(max: number): number[] {
  const tope = Math.max(max, 0.1);
  const bruto = tope / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map(f => f * potencia).find(p => p >= bruto) ?? 10 * potencia;
  const marcas = [0];
  while (marcas[marcas.length - 1] < tope - 1e-9) marcas.push(Number((marcas[marcas.length - 1] + paso).toFixed(6)));
  return marcas;
}
const cifraEje = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
/** Ancho aproximado de un texto (Segoe UI, seminegrita). */
const anchoTexto = (texto: string, tamano = 11.5) => texto.length * tamano * 0.585;
const hayDatos = (g: Grafico) => g.categorias.some(c => c.valores.some(v => v !== null));
/** Valor que se dibuja de una categoría: el total del motor si va apilado, o el único valor. */
const totalDe = (g: Grafico, c: Categoria) => (g.apilado ? (c.total ?? null) : c.valores[0]);
const sinSerie = (g: Grafico, k: number) => g.categorias.every(c => c.valores[k] === null);

function filasTip(g: Grafico, c: Categoria): FilaTip[] {
  const filas: FilaTip[] = g.series.map((s, k) => ({ nombre: s.nombre, valor: horasLargo(c.valores[k]), clase: s.clase, fuerte: g.series.length === 1 }));
  if (g.apilado) filas.push({ nombre: g.totalNombre, valor: horasLargo(c.total ?? null), fuerte: true });
  return filas;
}
function textoCategoria(g: Grafico, c: Categoria): string {
  const partes = g.series.map((s, k) => `${s.nombre} ${c.valores[k] === null ? 'sin datos' : `${horas(c.valores[k])} horas`}`);
  if (g.apilado) partes.push(`${g.totalNombre} ${horas(c.total ?? null)} horas`);
  return `${c.titulo}: ${partes.join(', ')}`;
}
function pistaDe(g: Grafico, c: Categoria): string | undefined {
  if (!g.dimension) return undefined;
  return g.seleccion.has(c.clave) ? 'Clic para quitar este filtro' : 'Clic para filtrar toda la página';
}

function leyendaDe(g: Grafico): HTMLElement | null {
  if (g.series.length < 2) return null;
  const lista = crear('ul', 't1-leyenda');
  lista.setAttribute('aria-label', 'Convenciones');
  for (const [k, s] of g.series.entries()) {
    const li = crear('li');
    li.append(crear('i', `t1-muestra ${g.forma === 'linea' ? 't1-muestra-linea ' : ''}${s.clase}`), s.nombre);
    if (sinSerie(g, k)) li.append(crear('span', 't1-leyenda-nota', '· sin datos'));
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
  [g.encabezado, ...g.series.map(s => `${s.nombre} (h)`), ...(g.apilado ? [`${g.totalNombre} (h)`] : [])].forEach((texto, i) => {
    const th = crear('th', i ? 'num' : undefined, texto);
    th.scope = 'col';
    cabeza.append(th);
  });
  const cuerpo = tabla.createTBody();
  const celda = (v: number | null, clase = 'num') => {
    const td = crear('td', clase, horas(v));
    if (v !== null) td.append(crear('small', undefined, horasATexto(v)));
    return td;
  };
  g.categorias.forEach((c, i) => {
    const fila = cuerpo.insertRow();
    fila.style.setProperty('--f', String(i));
    const th = crear('th', undefined, c.titulo);
    th.scope = 'row';
    fila.append(th, ...c.valores.map(v => celda(v)));
    if (g.apilado) fila.append(celda(c.total ?? null, 'num t1-total'));
  });
  caja.append(tabla);
  return caja;
}

/** Teclado común: flechas para pasar de una marca a otra; Enter o espacio filtra (si el gráfico filtra). */
function conTeclado(g: Grafico, svg: SVGSVGElement, n: number, mostrar: (i: number) => void, limpiar: () => void, horizontal: boolean) {
  const enfocar = (i: number) => {
    g.foco = Math.max(0, Math.min(n - 1, i));
    mostrar(g.foco);
    anuncio.textContent = textoCategoria(g, g.categorias[g.foco]);
  };
  svg.addEventListener('focus', () => enfocar(Math.min(g.foco, n - 1)));
  svg.addEventListener('blur', () => { limpiar(); ocultarTip(); });
  svg.addEventListener('keydown', evento => {
    const pasos: Record<string, number> = horizontal ? { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 } : { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 };
    if (evento.key in pasos) { evento.preventDefault(); enfocar(g.foco + pasos[evento.key]); }
    else if (evento.key === 'Home') { evento.preventDefault(); enfocar(0); }
    else if (evento.key === 'End') { evento.preventDefault(); enfocar(n - 1); }
    else if (evento.key === 'Escape') ocultarTip();
    else if ((evento.key === 'Enter' || evento.key === ' ') && g.dimension) { evento.preventDefault(); alternar(g.dimension, g.categorias[g.foco].clave); }
  });
}
function etiquetaAccesible(g: Grafico, unidad: string, ayuda: string): string {
  const n = g.categorias.length;
  return `${g.nombre}, en horas. ${n === 1 ? `Un ${unidad}` : `${n} ${unidad}s`}. ${ayuda} ${g.categorias.slice(0, 16).map(c => textoCategoria(g, c)).join('. ')}`;
}

/** Barras horizontales (por CD y por gerencia); apiladas para el FTCT. El valor va en la punta de cada barra. */
function dibujarBarras(g: Grafico, ancho: number): SVGSVGElement {
  const n = g.categorias.length;
  // Tablero compacto (como el Power BI): filas bajas.
  const FILA = n > 9 ? 20 : 30;
  const GROSOR = n > 9 ? 13 : 18;
  const IZQUIERDA = Math.round(Math.min(ancho * 0.42, Math.max(...g.categorias.map(c => anchoTexto(c.etiqueta, 12.5))) + 22));
  const DERECHA = 46;
  const ARRIBA = 4;
  const alto = ARRIBA * 2 + n * FILA;
  const totales = g.categorias.map(c => totalDe(g, c));
  const tope = Math.max(0.01, ...totales.map(t => t ?? 0));
  const largo = Math.max(40, ancho - IZQUIERDA - DERECHA);
  const filtra = !!g.dimension;
  const svg = nodo('svg', { width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}`, class: `t1-svg${filtra ? ' t1-filtra' : ''}${g.seleccion.size ? ' t1-con-seleccion' : ''}`, tabindex: 0, role: 'img' });
  svg.setAttribute('aria-label', etiquetaAccesible(g, 'barra', `Usa las flechas para leer cada una${filtra ? ' y Enter para filtrar la página' : ''}.`));
  svg.append(nodo('line', { x1: IZQUIERDA, x2: IZQUIERDA, y1: 0, y2: alto, class: 't1-base' }));
  const marcas: SVGGElement[] = [];
  g.categorias.forEach((c, i) => {
    const y0 = ARRIBA + i * FILA;
    const centro = y0 + FILA / 2;
    const elegida = g.seleccion.has(c.clave);
    const grupo = nodo('g', { class: `t1-marca${elegida ? ' t1-elegida' : ''}${g.seleccion.size && !elegida ? ' t1-atenuada' : ''}`, style: `--i:${i}` });
    grupo.append(nodo('rect', { x: 0, y: y0 + 1, width: ancho, height: FILA - 2, rx: 6, class: 't1-zona' }));
    grupo.append(nodo('text', { x: IZQUIERDA - 10, y: centro, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 't1-eje t1-eje-cat' }, c.etiqueta));
    const barra = nodo('g', { class: 't1-barra' });
    const top = centro - GROSOR / 2;
    // Partes de la barra: con apilado, la atención y lo que el FTCT suma de espera (así la punta llega al FTCT exacto).
    const partes = g.apilado
      ? (c.total == null ? [] : [c.valores[0] ?? 0, Math.max(0, c.total - (c.valores[0] ?? 0))])
      : [c.valores[0] ?? 0];
    const ultima = partes.reduce((u, v, k) => (v > 0 ? k : u), -1);
    let x = IZQUIERDA;
    partes.forEach((v, k) => {
      if (v <= 0) return;
      const w = (v / tope) * largo;
      if (k === ultima) {
        const r = Math.min(4, GROSOR / 2, w);
        barra.append(nodo('path', { class: `t1-parte ${g.series[k].clase}`, d: `M${x} ${top}H${x + w - r}a${r} ${r} 0 0 1 ${r} ${r}V${top + GROSOR - r}a${r} ${r} 0 0 1 ${-r} ${r}H${x}z` }));
      } else if (w > 2) {
        barra.append(nodo('rect', { class: `t1-parte ${g.series[k].clase}`, x, y: top, width: w - 2, height: GROSOR }));
      }
      x += w;
    });
    grupo.append(barra);
    const total = totales[i];
    grupo.append(nodo('text', { x: total === null ? IZQUIERDA + 8 : IZQUIERDA + (total / tope) * largo + 7, y: centro, 'dominant-baseline': 'central', class: `t1-cifra${total === null ? ' t1-cifra-nula' : ''}` }, horas(total)));
    const mostrar = (cx: number, cy: number) => {
      svg.classList.add('t1-enfoque');
      marcas.forEach((m, k) => m.classList.toggle('t1-activa', k === i));
      mostrarTip(c.titulo, filasTip(g, c), cx, cy, pistaDe(g, c));
    };
    grupo.addEventListener('pointermove', evento => { g.foco = i; mostrar(evento.clientX, evento.clientY); });
    grupo.addEventListener('pointerleave', () => { svg.classList.remove('t1-enfoque'); grupo.classList.remove('t1-activa'); ocultarTip(); });
    if (filtra) grupo.addEventListener('click', () => alternar(g.dimension!, c.clave));
    (grupo as SVGGElement & { mostrar?: () => void }).mostrar = () => {
      const caja = svg.getBoundingClientRect();
      mostrar(caja.left + IZQUIERDA + ((total ?? 0) / tope) * largo, caja.top + top);
    };
    marcas.push(grupo);
    svg.append(grupo);
  });
  conTeclado(g, svg, n, i => (marcas[i] as SVGGElement & { mostrar?: () => void }).mostrar?.(), () => { svg.classList.remove('t1-enfoque'); marcas.forEach(m => m.classList.remove('t1-activa')); }, false);
  return svg;
}

/** Columnas (una serie o dos lado a lado). El valor va sobre cada columna si cabe. */
function dibujarColumnas(g: Grafico, ancho: number): SVGSVGElement {
  const n = g.categorias.length;
  // Una serie sin ningún dato (la espera en noviembre) no ocupa lugar: la otra queda centrada.
  const activas = g.series.map((_, s) => s).filter(s => !sinSerie(g, s));
  const k = Math.max(1, activas.length);
  const maximo = Math.max(...g.categorias.flatMap(c => c.valores).map(v => v ?? 0));
  const marcas = marcasEje(maximo * 1.05);
  const tope = marcas[marcas.length - 1];
  const etiquetasEje = marcas.map(cifraEje);
  const IZQUIERDA = Math.round(Math.max(...etiquetasEje.map(t => anchoTexto(t))) + 14);
  const DERECHA = 8;
  const ARRIBA = 22;
  const largo = Math.max(60, ancho - IZQUIERDA - DERECHA);
  const hueco = largo / n;
  const grosor = Math.max(3, Math.min(24, (hueco * 0.72 - 2 * (k - 1)) / k));
  const ALTO = Math.round(Math.min(210, Math.max(140, ancho * 0.24)));
  const ABAJO = 30;
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
  // Cifras: si caben sobre cada columna (con dos series, sobre su propia columna).
  const espacio = k > 1 ? grosor + 6 : hueco - 4;
  const caben = g.categorias.every(c => c.valores.every(v => v === null || anchoTexto(horas(v), 11) <= espacio));
  const columnas: SVGGElement[] = [];
  g.categorias.forEach((c, i) => {
    const centro = IZQUIERDA + hueco * (i + 0.5);
    const elegida = g.seleccion.has(c.clave);
    const grupo = nodo('g', { class: `t1-marca${elegida ? ' t1-elegida' : ''}${g.seleccion.size && !elegida ? ' t1-atenuada' : ''}`, style: `--i:${i}` });
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
        barra.append(nodo('path', { class: `t1-parte ${g.series[s].clase}`, d: `M${x} ${base}V${base - alto + r}a${r} ${r} 0 0 1 ${r} ${-r}h${grosor - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${base}z` }));
        grupo.append(barra);
      }
      if (caben) grupo.append(nodo('text', { x: x + grosor / 2, y: yDe(v) - 6, 'text-anchor': 'middle', class: 't1-cifra t1-cifra-col' }, horas(v)));
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
    (grupo as SVGGElement & { mostrar?: () => void }).mostrar = () => {
      const caja = svg.getBoundingClientRect();
      mostrar(caja.left + centro, caja.top + yDe(mayor));
    };
    columnas.push(grupo);
    svg.append(grupo);
  });
  conTeclado(g, svg, n, i => (columnas[i] as SVGGElement & { mostrar?: () => void }).mostrar?.(), () => { svg.classList.remove('t1-enfoque'); columnas.forEach(col => col.classList.remove('t1-activa')); }, true);
  return svg;
}

/** Líneas de 2 px con un punto por día o mes; una línea vertical sigue al puntero y la ventanita lee las dos series. */
function dibujarLinea(g: Grafico, ancho: number): SVGSVGElement {
  const n = g.categorias.length;
  const valores = g.categorias.flatMap(c => c.valores).filter((v): v is number => v !== null);
  const marcas = marcasEje(Math.max(...valores) * 1.05);
  const tope = marcas[marcas.length - 1];
  const etiquetasEje = marcas.map(cifraEje);
  const IZQUIERDA = Math.round(Math.max(...etiquetasEje.map(t => anchoTexto(t))) + 14);
  const DERECHA = 42;
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
      puntos.append(nodo('circle', { cx: xDe(i), cy: yDe(v), r: 4, class: `t1-punto ${s.clase}` }));
    });
    svg.append(puntos);
    // Cifra al final de cada línea (si no choca con la otra).
    let ultimo = -1;
    for (let i = n - 1; i >= 0; i--) if (g.categorias[i].valores[k] !== null) { ultimo = i; break; }
    const y = yDe(g.categorias[ultimo].valores[k]!);
    if (!cifrasFinales.some(u => Math.abs(u - y) < 15)) {
      cifrasFinales.push(y);
      svg.append(nodo('text', { x: xDe(ultimo) + 8, y, 'dominant-baseline': 'central', class: 't1-cifra t1-cifra-final' }, horas(g.categorias[ultimo].valores[k])));
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
  conTeclado(g, svg, n, i => mostrar(i), limpiar, true);
  return svg;
}

function dibujar(g: Grafico, animar = true) {
  const ancho = Math.floor(g.caja.clientWidth);
  g.ancho = ancho;
  g.caja.classList.toggle('t1-quieto', !animar);
  if (g.caja.contains(document.querySelector('.t1-activa'))) ocultarTip();
  if (!hayDatos(g)) { g.caja.replaceChildren(crear('p', 't1-grafico-vacio', g.vacio)); return; }
  if (g.enTabla) { g.caja.replaceChildren(tablaDe(g)); return; }
  if (!ancho) return; // Oculto: se dibuja al mostrarse (ResizeObserver).
  const svg = g.forma === 'linea' ? dibujarLinea(g, ancho) : g.forma === 'barras' ? dibujarBarras(g, ancho) : dibujarColumnas(g, ancho);
  const leyenda = leyendaDe(g);
  g.caja.replaceChildren(...(leyenda ? [leyenda, svg] : [svg]));
}

function ponerCategorias(g: Grafico, categorias: Categoria[], subtitulo?: string) {
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

// ---------- Mapas de calor (CD × fecha) ----------

interface MapaCalor { caja: HTMLElement; subtitulo: HTMLElement; nombre: string; tipo: 'at' | 'es'; mapa: Mapa | null; inicio: number | null; ancho: number; fechasClave: string }
const mapas: MapaCalor[] = [
  { caja: porId('t1MapaAt'), subtitulo: porId('t1MapaAtS'), nombre: 'Atención promedio', tipo: 'at', mapa: null, inicio: null, ancho: 0, fechasClave: '' },
  { caja: porId('t1MapaEs'), subtitulo: porId('t1MapaEsS'), nombre: 'Espera promedio', tipo: 'es', mapa: null, inicio: null, ancho: 0, fechasClave: '' },
];

// Colores en OKLab: la escala va de un tono cercano al fondo (poco tiempo) a uno intenso (mucho tiempo).
type Lab = [number, number, number];
const aLineal = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const aSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function rgbDe(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  return [0, 2, 4].map(i => aLineal(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
}
function aLab(hex: string): Lab {
  const [r, g, b] = rgbDe(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function deLab([L, A, B]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map(c => Math.min(1, Math.max(0, c))) as [number, number, number];
}
const hexDe = (rgb: [number, number, number]) => `#${rgb.map(c => Math.round(aSrgb(c) * 255).toString(16).padStart(2, '0')).join('')}`;
const luminancia = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Escala de 3 puntos (bajo, medio, alto) leída de las variables del tema actual. */
function escala(tipo: 'at' | 'es'): (t: number) => { fondo: string; texto: string } {
  const estilos = getComputedStyle(document.body);
  const puntos = [0, 1, 2].map(i => aLab(estilos.getPropertyValue(`--t1-mapa-${tipo}-${i}`) || '#888888'));
  return t => {
    const u = Math.min(1, Math.max(0, t)) * 2;
    const [a, b] = u <= 1 ? [puntos[0], puntos[1]] : [puntos[1], puntos[2]];
    const f = u <= 1 ? u : u - 1;
    const rgb = deLab([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    // Texto negro o blanco, el que más contraste tenga con la celda.
    const y = luminancia(rgb);
    return { fondo: hexDe(rgb), texto: (y + 0.05) / 0.05 >= 1.05 / (y + 0.05) ? '#000000' : '#ffffff' };
  };
}

function vacioMapaEspera(): Node {
  const caja = crear('div', 't1-grafico-vacio t1-mapa-vacio');
  const ue = opciones?.ultimaEspera ?? null;
  caja.append(crear('p', undefined, ue === null ? 'Aún no se ha cargado ESPERA.xlsx.' : filtro.desde > ue ? `Sin datos de espera en este rango: la espera llega hasta el ${fecha(ue)}.` : 'Sin datos de espera con estos filtros.'));
  if (ue !== null && filtro.desde > ue) {
    const boton = crear('button', 't1-boton-sec', `Ver del ${fecha(primerDiaMes(ue))} al ${fecha(ue)}`);
    boton.type = 'button';
    boton.addEventListener('click', () => verHastaEspera());
    caja.append(boton);
  }
  return caja;
}

function dibujarMapa(m: MapaCalor) {
  const ancho = Math.floor(m.caja.clientWidth);
  m.ancho = ancho;
  const mapa = m.mapa;
  const hay = !!mapa && mapa.valores.some(f => f.some(v => v !== null));
  if (!mapa || !hay) {
    m.caja.replaceChildren(m.tipo === 'es' && datos ? vacioMapaEspera() : crear('p', 't1-grafico-vacio', 'Sin registros con estos filtros.'));
    return;
  }
  if (!ancho) return;
  const { cds, fechas, valores } = mapa;
  const ANCHO_CD = Math.max(96, Math.max(...cds.map(cd => anchoTexto(cd, 13))) + 26);
  const porPagina = Math.max(4, Math.floor((ancho - ANCHO_CD) / 46));
  const ultimaPagina = Math.max(0, fechas.length - porPagina);
  const inicio = Math.min(Math.max(0, m.inicio ?? ultimaPagina), ultimaPagina);
  m.inicio = inicio;
  const visibles = fechas.slice(inicio, inicio + porPagina);

  // Escala: del menor valor al percentil 95 (un valor muy alto no apaga el resto); por encima, color máximo.
  const todos = valores.flat().filter((v): v is number => v !== null).sort((a, b) => a - b);
  const minimo = todos[0];
  const maximo = Math.max(minimo + 0.05, todos[Math.min(todos.length - 1, Math.floor(todos.length * 0.95))]);
  const color = escala(m.tipo);

  const tabla = crear('table', 't1-mapa');
  tabla.style.setProperty('--t1-ancho-cd', `${ANCHO_CD}px`);
  tabla.append(crear('caption', 'cc-oculto', `${m.nombre} en horas por CD (filas) y fecha (columnas)`));
  const colgrupo = crear('colgroup');
  colgrupo.append(crear('col', 't1-mapa-col-cd'), ...visibles.map(() => crear('col')));
  tabla.append(colgrupo);
  const cabeza = tabla.createTHead();
  // Fila de meses (agrupa las columnas del mismo mes).
  const filaMes = cabeza.insertRow();
  filaMes.className = 't1-mapa-meses';
  const esquina = crear('th', 't1-mapa-esquina', 'CD');
  esquina.rowSpan = 2;
  esquina.scope = 'col';
  filaMes.append(esquina);
  let mesActual = '';
  for (const f of visibles) {
    const mes = mesDeDia(f);
    if (mes === mesActual) { (filaMes.lastElementChild as HTMLTableCellElement).colSpan += 1; continue; }
    mesActual = mes;
    const th = crear('th', 't1-mapa-mes', nombreMes(mes));
    th.scope = 'colgroup';
    filaMes.append(th);
  }
  const filaDia = cabeza.insertRow();
  for (const f of visibles) {
    const th = crear('th', `t1-mapa-dia${fechaDeDia(f).getUTCDay() === 0 ? ' t1-domingo' : ''}`);
    th.scope = 'col';
    th.setAttribute('aria-label', fechaLarga(f));
    th.append(crear('small', undefined, DIA_CORTO[fechaDeDia(f).getUTCDay()].charAt(0).toUpperCase()), crear('b', undefined, String(fechaDeDia(f).getUTCDate())));
    filaDia.append(th);
  }
  const cuerpo = tabla.createTBody();
  cds.forEach((cd, fila) => {
    const tr = cuerpo.insertRow();
    tr.style.setProperty('--f', String(fila));
    const th = crear('th', 't1-mapa-cd', cd);
    th.scope = 'row';
    tr.append(th);
    visibles.forEach((f, j) => {
      const v = valores[fila][inicio + j];
      const td = crear('td', v === null ? 't1-celda-vacia' : 't1-celda');
      if (v === null) { td.setAttribute('aria-label', 'sin datos'); }
      else {
        const c = color((v - minimo) / (maximo - minimo));
        td.style.background = c.fondo;
        td.style.color = c.texto;
        td.textContent = horas(v);
      }
      td.dataset.f = String(inicio + j);
      td.dataset.c = String(fila);
      td.style.setProperty('--j', String(j));
      tr.append(td);
    });
  });
  tabla.addEventListener('pointermove', evento => {
    const td = (evento.target as Element).closest<HTMLTableCellElement>('td[data-f]');
    if (!td) { ocultarTip(); return; }
    const fila = Number(td.dataset.c);
    const col = Number(td.dataset.f);
    const v = valores[fila][col];
    mostrarTip(`${cds[fila]} · ${fechaLarga(fechas[col])}`, [{ nombre: m.nombre, valor: horasLargo(v), clase: m.tipo === 'at' ? ATENCION.clase : ESPERA.clase, fuerte: true }], evento.clientX, evento.clientY);
  });
  tabla.addEventListener('pointerleave', ocultarTip);

  const partes: Node[] = [];
  // Escala de color y, si no caben todos los días, flechas para pasar de página.
  const pie = crear('div', 't1-mapa-pie');
  const leyenda = crear('div', 't1-escala');
  const muestra = crear('span', 't1-escala-barra');
  muestra.style.background = `linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => color(t).fondo).join(',')})`;
  leyenda.append(crear('span', undefined, `${horas(minimo)} h`), muestra, crear('span', undefined, `${maximo < todos[todos.length - 1] ? '≥ ' : ''}${horas(maximo)} h`));
  leyenda.setAttribute('aria-label', `Escala: de ${horas(minimo)} a ${horas(maximo)} horas; más oscuro${document.documentElement.dataset.tema === 'claro' ? '' : ' (más claro en el tema oscuro)'} es más tiempo.`);
  pie.append(leyenda);
  if (fechas.length > porPagina) {
    const nav = crear('div', 't1-mapa-nav');
    const anterior = crear('button', 't1-flecha');
    anterior.type = 'button';
    anterior.setAttribute('aria-label', 'Días anteriores');
    anterior.append(icono('m14.5 6-6 6 6 6'));
    anterior.disabled = inicio === 0;
    const siguiente = crear('button', 't1-flecha');
    siguiente.type = 'button';
    siguiente.setAttribute('aria-label', 'Días siguientes');
    siguiente.append(icono('m9.5 6 6 6-6 6'));
    siguiente.disabled = inicio >= ultimaPagina;
    // Tras pasar de página, el foco queda en la misma flecha (o en la otra si esa ya no se puede usar).
    const pasar = (nuevo: number, cual: 0 | 1) => {
      m.inicio = nuevo;
      dibujarMapa(m);
      const flechas = m.caja.querySelectorAll<HTMLButtonElement>('.t1-flecha');
      (flechas[cual]?.disabled ? flechas[1 - cual] : flechas[cual])?.focus();
    };
    anterior.addEventListener('click', () => pasar(Math.max(0, inicio - porPagina), 0));
    siguiente.addEventListener('click', () => pasar(Math.min(ultimaPagina, inicio + porPagina), 1));
    nav.append(anterior, crear('span', 't1-mapa-rango', `${diaCorto(visibles[0])} – ${diaCorto(visibles[visibles.length - 1])} · ${cifra(visibles.length)} de ${cifra(fechas.length)} días`), siguiente);
    pie.append(nav);
  }
  const caja = crear('div', 't1-mapa-tabla');
  caja.append(tabla);
  partes.push(caja, pie);
  m.caja.replaceChildren(...partes);
}

for (const m of mapas) {
  let cuadro = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(cuadro);
    cuadro = requestAnimationFrame(() => { if (Math.floor(m.caja.clientWidth) !== m.ancho) dibujarMapa(m); });
  }).observe(m.caja);
}
// Los colores del mapa salen del tema: al cambiarlo se vuelven a pintar.
new MutationObserver(() => { for (const m of mapas) dibujarMapa(m); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });

// ---------- Tablas con páginas ----------

interface Columna<T> { titulo: string; num?: boolean; texto: (f: T) => string; extra?: (f: T) => string; orden: (a: T, b: T) => number; primero?: 1 | -1 }
interface Tabla<T> {
  nombre: string; columnas: Columna<T>[]; filas: T[]; placa: (f: T) => string; vacio: string;
  pagina: number; orden: { col: number; dir: 1 | -1 } | null; buscar: string;
  cabeza: HTMLTableRowElement; cuerpo: HTMLTableSectionElement; info: HTMLElement; cuenta: HTMLElement;
  primera: HTMLButtonElement; anterior: HTMLButtonElement; siguiente: HTMLButtonElement; ultima: HTMLButtonElement;
}
const POR_PAGINA = 10;

function botonPagina(etiqueta: string, trazos: string): HTMLButtonElement {
  const b = crear('button', 't1-flecha');
  b.type = 'button';
  b.setAttribute('aria-label', etiqueta);
  b.title = etiqueta;
  b.append(icono(trazos));
  return b;
}

function crearTabla<T>(id: string, nombre: string, columnas: Columna<T>[], placa: (f: T) => string, ordenInicial: Tabla<T>['orden'] = null): Tabla<T> {
  const zona = porId(id);
  const barra = crear('div', 't1-tabla-barra');
  const buscarCaja = crear('label', 't1-buscar');
  const buscar = crear('input');
  buscar.type = 'search';
  buscar.placeholder = 'Buscar placa';
  buscar.autocomplete = 'off';
  buscar.spellcheck = false;
  buscar.setAttribute('aria-label', `Buscar placa en ${nombre.toLowerCase()}`);
  buscarCaja.append(icono('M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8'), buscar);
  const cuenta = crear('span', 't1-tabla-cuenta');
  barra.append(buscarCaja, cuenta);
  const caja = crear('div', 't1-tabla-caja');
  const tabla = crear('table', 't1-tabla t1-tabla-paginada');
  tabla.append(crear('caption', 'cc-oculto', nombre));
  const cabeza = tabla.createTHead().insertRow();
  const cuerpo = tabla.createTBody();
  caja.append(tabla);
  const pie = crear('div', 't1-paginas');
  const info = crear('span', 't1-paginas-info');
  const primera = botonPagina('Primera página', 'M7 6v12M17.5 6l-6 6 6 6');
  const anterior = botonPagina('Página anterior', 'm14.5 6-6 6 6 6');
  const siguiente = botonPagina('Página siguiente', 'm9.5 6 6 6-6 6');
  const ultima = botonPagina('Última página', 'M17 6v12M6.5 6l6 6-6 6');
  const botones = crear('div', 't1-paginas-botones');
  botones.append(primera, anterior, siguiente, ultima);
  pie.append(info, botones);
  zona.replaceChildren(barra, caja, pie);
  const t: Tabla<T> = { nombre, columnas, filas: [], placa, vacio: 'Sin registros con estos filtros.', pagina: 0, orden: ordenInicial, buscar: '', cabeza, cuerpo, info, cuenta, primera, anterior, siguiente, ultima };
  columnas.forEach((col, i) => {
    const th = crear('th', col.num ? 'num' : undefined);
    th.scope = 'col';
    const b = crear('button', 't1-orden');
    b.type = 'button';
    b.append(crear('span', undefined, col.titulo), crear('i', 't1-orden-flecha'));
    b.addEventListener('click', () => {
      t.orden = t.orden?.col === i ? { col: i, dir: (t.orden.dir * -1) as 1 | -1 } : { col: i, dir: col.primero ?? 1 };
      t.pagina = 0;
      pintarTabla(t);
    });
    th.append(b);
    cabeza.append(th);
  });
  buscar.addEventListener('input', () => { t.buscar = buscar.value; t.pagina = 0; pintarTabla(t); });
  primera.addEventListener('click', () => { t.pagina = 0; pintarTabla(t); });
  anterior.addEventListener('click', () => { t.pagina -= 1; pintarTabla(t); });
  siguiente.addEventListener('click', () => { t.pagina += 1; pintarTabla(t); });
  ultima.addEventListener('click', () => { t.pagina = Number.MAX_SAFE_INTEGER; pintarTabla(t); });
  return t;
}

function pintarTabla<T>(t: Tabla<T>) {
  const q = t.buscar.trim().toUpperCase();
  let vista = q ? t.filas.filter(f => t.placa(f).toUpperCase().includes(q)) : t.filas;
  if (t.orden) { const { col, dir } = t.orden; vista = [...vista].sort((a, b) => dir * t.columnas[col].orden(a, b)); }
  const paginas = Math.max(1, Math.ceil(vista.length / POR_PAGINA));
  t.pagina = Math.max(0, Math.min(t.pagina, paginas - 1));
  const desde = t.pagina * POR_PAGINA;
  const filas = vista.slice(desde, desde + POR_PAGINA);
  [...t.cabeza.cells].forEach((th, i) => th.setAttribute('aria-sort', t.orden?.col === i ? (t.orden.dir === 1 ? 'ascending' : 'descending') : 'none'));
  if (!filas.length) {
    const tr = crear('tr', 't1-fila-vacia');
    const td = crear('td', undefined, q ? `Ninguna placa coincide con «${t.buscar.trim()}».` : t.vacio);
    td.colSpan = t.columnas.length;
    tr.append(td);
    t.cuerpo.replaceChildren(tr);
  } else {
    t.cuerpo.replaceChildren(...filas.map((f, i) => {
      const tr = crear('tr');
      tr.style.setProperty('--f', String(i));
      t.columnas.forEach((col, k) => {
        const celda = crear(k === 0 ? 'th' : 'td', col.num ? 'num' : undefined, col.texto(f));
        if (k === 0) (celda as HTMLTableCellElement).scope = 'row';
        const extra = col.extra?.(f);
        if (extra) celda.append(crear('small', undefined, extra));
        tr.append(celda);
      });
      return tr;
    }));
  }
  t.info.textContent = vista.length ? `${cifra(desde + 1)}–${cifra(desde + filas.length)} de ${cifra(vista.length)}` : '0 de 0';
  t.cuenta.textContent = plural(t.filas.length, 'fila', 'filas');
  t.primera.disabled = t.anterior.disabled = t.pagina === 0;
  t.siguiente.disabled = t.ultima.disabled = t.pagina >= paginas - 1;
}

const porTexto = new Intl.Collator('es', { numeric: true }).compare;
/** Como en el Power BI, el detalle suma los registros iguales (misma fecha, placa y tiempo): se avisa cuántos son. */
function repetidos(totalHoras: number, minutos: number | null): string {
  if (!minutos) return '';
  const veces = Math.round(totalHoras / (minutos / 60));
  return veces > 1 ? `${veces} reg.` : '';
}
const minutosDeTexto = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
type DetAt = ResultadoT1['detalleAtencion'][number];
type DetEs = ResultadoT1['detalleEspera'][number];
type PorPlaca = ResultadoT1['atencionPorPlaca'][number];
const tablas = {
  detAtencion: crearTabla<DetAt>('t1TDetAt', 'Detalle de tiempos de atención', [
    { titulo: 'Fecha', texto: f => fecha(f.fecha), orden: (a, b) => a.fecha - b.fecha, primero: -1 },
    { titulo: 'Placa', texto: f => f.placa, orden: (a, b) => porTexto(a.placa, b.placa) },
    { titulo: 'Tiempo', num: true, texto: f => hhmm(f.minutos), orden: (a, b) => a.minutos - b.minutos, primero: -1 },
    { titulo: 'Horas', num: true, texto: f => horas(f.horas), extra: f => repetidos(f.horas, f.minutos), orden: (a, b) => a.horas - b.horas, primero: -1 },
  ], f => f.placa),
  detEspera: crearTabla<DetEs>('t1TDetEs', 'Detalle de tiempos de espera', [
    { titulo: 'Fecha', texto: f => fecha(f.fecha), orden: (a, b) => a.fecha - b.fecha, primero: -1 },
    { titulo: 'Placa', texto: f => f.placa, orden: (a, b) => porTexto(a.placa, b.placa) },
    { titulo: 'Espera', num: true, texto: f => f.espera, orden: (a, b) => a.horas - b.horas, primero: -1 },
    { titulo: 'Horas', num: true, texto: f => horas(f.horas), extra: f => repetidos(f.horas, minutosDeTexto(f.espera)), orden: (a, b) => a.horas - b.horas, primero: -1 },
  ], f => f.placa),
  placaAtencion: crearTabla<PorPlaca>('t1TPlAt', 'Atención por placa', [
    { titulo: 'Placa', texto: f => f.placa, orden: (a, b) => porTexto(a.placa, b.placa) },
    { titulo: 'Promedio (h)', num: true, texto: f => horas(f.horas), extra: f => horasATexto(f.horas), orden: (a, b) => a.horas - b.horas, primero: -1 },
  ], f => f.placa, { col: 1, dir: -1 }),
  placaEspera: crearTabla<PorPlaca>('t1TPlEs', 'Espera por placa', [
    { titulo: 'Placa', texto: f => f.placa, orden: (a, b) => porTexto(a.placa, b.placa) },
    { titulo: 'Espera total (h)', num: true, texto: f => horas(f.horas), extra: f => horasATexto(f.horas), orden: (a, b) => a.horas - b.horas, primero: -1 },
  ], f => f.placa, { col: 1, dir: -1 }),
};
function ponerFilas<T>(t: Tabla<T>, filas: T[], vacio: string) {
  t.filas = filas;
  t.vacio = vacio;
  t.pagina = 0;
  pintarTabla(t);
}

// ---------- Filtros ----------

/** Lista desplegable con casillas (CD, gerencia y semana), como los segmentadores de selección múltiple. */
interface Multi { dim: 'cds' | 'gerencias' | 'semanas'; raiz: HTMLElement; boton: HTMLButtonElement; valor: HTMLElement; panel: HTMLElement; lista: HTMLElement; nombre: string }
function crearMulti(id: string, dim: Multi['dim'], nombre: string): Multi {
  const raiz = porId(id);
  const etiqueta = raiz.querySelector('.t1-etiqueta')!;
  const boton = crear('button', 't1-multi-boton');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');
  boton.setAttribute('aria-controls', `${id}Panel`);
  const valor = crear('span', 't1-multi-valor', 'Todos');
  valor.id = `${id}Valor`;
  boton.setAttribute('aria-labelledby', `${etiqueta.id} ${valor.id}`);
  boton.append(valor, icono('m6 9 6 6 6-6'));
  const panel = crear('div', 't1-multi-panel');
  panel.id = `${id}Panel`;
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-labelledby', etiqueta.id);
  const todos = crear('button', 't1-multi-todos', `Todos (quitar el filtro de ${nombre})`);
  todos.type = 'button';
  const lista = crear('div', 't1-multi-lista');
  panel.append(todos, lista);
  raiz.append(boton, panel);
  const m: Multi = { dim, raiz, boton, valor, panel, lista, nombre };
  boton.addEventListener('click', () => abrirMulti(m, panel.hidden !== false));
  todos.addEventListener('click', () => { (filtro[dim] as unknown[]).length = 0; pintarFiltros(); recalcular(); });
  panel.addEventListener('keydown', evento => { if (evento.key === 'Escape') { abrirMulti(m, false); boton.focus(); } });
  lista.addEventListener('change', evento => {
    const casilla = evento.target as HTMLInputElement;
    const v = dim === 'semanas' ? Number(casilla.value) : casilla.value;
    const lista = filtro[dim] as (string | number)[];
    const i = lista.indexOf(v);
    if (casilla.checked && i < 0) lista.push(v);
    if (!casilla.checked && i >= 0) lista.splice(i, 1);
    ordenarFiltro(dim);
    pintarFiltros();
    recalcular();
  });
  return m;
}
const multis = [crearMulti('t1MultiCds', 'cds', 'CD'), crearMulti('t1MultiGerencias', 'gerencias', 'gerencia'), crearMulti('t1MultiSemanas', 'semanas', 'semana')];
function abrirMulti(m: Multi, abrir: boolean) {
  for (const otro of multis) if (otro !== m || !abrir) { otro.panel.hidden = true; otro.boton.setAttribute('aria-expanded', 'false'); }
  if (abrir) { m.panel.hidden = false; m.boton.setAttribute('aria-expanded', 'true'); m.panel.querySelector<HTMLElement>('input, button')?.focus(); }
}
document.addEventListener('pointerdown', evento => {
  for (const m of multis) if (!m.panel.hidden && !m.raiz.contains(evento.target as Node)) abrirMulti(m, false);
});

function ordenarFiltro(dim: 'cds' | 'gerencias' | 'semanas') {
  if (dim === 'semanas') filtro.semanas.sort((a, b) => a - b);
  else filtro[dim].sort(porTexto);
}

/** Opciones de cada lista; las semanas, solo las del rango de fechas (y las ya elegidas). */
function llenarMulti(m: Multi) {
  if (!opciones) return;
  let items: { valor: string; texto: string; detalle?: string }[];
  if (m.dim === 'cds') items = opciones.cds.map(cd => ({ valor: cd, texto: cd }));
  else if (m.dim === 'gerencias') items = opciones.gerencias.map(g => ({ valor: g, texto: g }));
  else {
    items = opciones.semanas.filter(s => {
      const r = diasDeSemana.get(s);
      return filtro.semanas.includes(s) || (r && r[1] >= filtro.desde && r[0] <= filtro.hasta);
    }).map(s => { const r = diasDeSemana.get(s)!; return { valor: String(s), texto: `Semana ${s}`, detalle: `${diaCorto(r[0])} – ${diaCorto(r[1])}` }; });
  }
  const elegidos = new Set((filtro[m.dim] as (string | number)[]).map(String));
  m.lista.classList.toggle('t1-multi-lista-2', items.length > 8);
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
}

const diasChips = porId('t1Dias');
const turnosChips = porId('t1Turnos');
const TURNOS: { turno: Turno; horas: string }[] = [{ turno: 'A', horas: '6:00 a 13:59' }, { turno: 'B', horas: '14:00 a 21:59' }, { turno: 'C', horas: '22:00 a 5:59' }];
const LETRA_DIA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
for (const dia of [1, 2, 3, 4, 5, 6, 0]) {
  const b = crear('button', 't1-chip', LETRA_DIA[dia]);
  b.type = 'button';
  b.dataset.dia = String(dia);
  b.title = mayuscula(DIAS_SEMANA[dia]);
  b.setAttribute('aria-label', DIAS_SEMANA[dia]);
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    const i = filtro.diasSemana.indexOf(dia);
    if (i >= 0) filtro.diasSemana.splice(i, 1); else filtro.diasSemana.push(dia);
    filtro.diasSemana.sort((a, b2) => ((a + 6) % 7) - ((b2 + 6) % 7));
    pintarFiltros();
    recalcular();
  });
  diasChips.append(b);
}
for (const { turno, horas: rango } of TURNOS) {
  const b = crear('button', 't1-chip', turno);
  b.type = 'button';
  b.dataset.turno = turno;
  b.title = `Turno ${turno}: ${rango}`;
  b.setAttribute('aria-label', `Turno ${turno}, de ${rango}`);
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => alternar('turnos', turno));
  turnosChips.append(b);
}

/** Pone o quita un valor del filtro (también desde un clic en una barra, como el cruce de filtros del Power BI). */
function alternar(dim: Dimension, valor: string) {
  const lista = filtro[dim] as string[];
  const i = lista.indexOf(valor);
  if (i >= 0) lista.splice(i, 1); else lista.push(valor);
  if (dim === 'turnos') filtro.turnos.sort(); else ordenarFiltro(dim);
  const nombre = { cds: 'CD', gerencias: 'Gerencia', turnos: 'Turno' }[dim];
  anuncio.textContent = i >= 0 ? `Se quitó el filtro ${nombre} ${valor}.` : `Filtro aplicado: ${nombre} ${valor}.`;
  pintarFiltros();
  recalcular();
}

const primerDiaMes = (dia: number) => diaDeIso(`${mesDeDia(dia)}-01`);
/** Por defecto: el mes de la última fecha de ATCT, del día 1 a esa fecha. */
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
function verHastaEspera() {
  const ue = opciones?.ultimaEspera;
  if (ue == null) return;
  ponerRango(Math.max(opciones!.desde ?? ue, primerDiaMes(ue)), ue);
  porId('t1Filtros').scrollIntoView({ behavior: sinMovimiento.matches ? 'auto' : 'smooth', block: 'start' });
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
    const elegidos = filtro[m.dim] as (string | number)[];
    m.valor.textContent = !elegidos.length ? 'Todos' : elegidos.length === 1 ? (m.dim === 'semanas' ? `Semana ${elegidos[0]}` : String(elegidos[0])) : `${elegidos.length} elegidos`;
    m.boton.classList.toggle('t1-con-valor', elegidos.length > 0);
  }
  for (const b of diasChips.querySelectorAll<HTMLButtonElement>('.t1-chip')) b.setAttribute('aria-pressed', String(filtro.diasSemana.includes(Number(b.dataset.dia))));
  for (const b of turnosChips.querySelectorAll<HTMLButtonElement>('.t1-chip')) b.setAttribute('aria-pressed', String(filtro.turnos.includes(b.dataset.turno as Turno)));
  pintarActivos();
}

/** Lista de filtros aplicados, cada uno con su botón para quitarlo. */
function pintarActivos() {
  const lista = porId('t1Activos');
  const items: { texto: string; quitar: () => void }[] = [
    ...filtro.cds.map(v => ({ texto: `CD: ${v}`, quitar: () => alternar('cds', v) })),
    ...filtro.gerencias.map(v => ({ texto: `Gerencia: ${v}`, quitar: () => alternar('gerencias', v) })),
    ...filtro.semanas.map(v => ({ texto: `Semana ${v}`, quitar: () => { filtro.semanas.splice(filtro.semanas.indexOf(v), 1); pintarFiltros(); recalcular(); } })),
    ...filtro.diasSemana.map(v => ({ texto: mayuscula(DIAS_SEMANA[v]), quitar: () => { filtro.diasSemana.splice(filtro.diasSemana.indexOf(v), 1); pintarFiltros(); recalcular(); } })),
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
      (destino ?? porId<HTMLButtonElement>('t1Limpiar')).focus();
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
porId('t1Limpiar').addEventListener('click', () => {
  filtro.cds = []; filtro.gerencias = []; filtro.semanas = []; filtro.diasSemana = []; filtro.turnos = [];
  rangoInicial();
  rangoPorDefecto = true;
  for (const m of mapas) m.inicio = null;
  anuncio.textContent = 'Se quitaron los filtros.';
  pintarFiltros();
  recalcular();
});

// ---------- Pintar todo ----------

/** Las cifras cuentan desde su valor anterior hasta el nuevo. */
function contar(el: HTMLElement, valor: number | null, formato: (n: number) => string) {
  cancelAnimationFrame(Number(el.dataset.cuadro ?? 0));
  if (valor === null) { el.textContent = '—'; el.dataset.valor = ''; el.classList.add('t1-sin-dato'); return; }
  el.classList.remove('t1-sin-dato');
  const previo = el.dataset.valor ? Number(el.dataset.valor) : 0;
  el.dataset.valor = String(valor);
  if (sinMovimiento.matches || previo === valor) { el.textContent = formato(valor); return; }
  const inicio = performance.now();
  el.classList.remove('t1-kpi-salto');
  const paso = (ahora: number) => {
    const t = Math.min(1, (ahora - inicio) / 1100);
    el.textContent = formato(t < 1 ? previo + (valor - previo) * (1 - (1 - t) ** 3) : valor);
    if (t < 1) el.dataset.cuadro = String(requestAnimationFrame(paso));
    else { void el.offsetWidth; el.classList.add('t1-kpi-salto'); }
  };
  el.dataset.cuadro = String(requestAnimationFrame(paso));
}

const esperaFaltante = () => { const ue = opciones?.ultimaEspera ?? null; return ue === null || filtro.desde > ue; };

function pintarTarjetas(r: ResultadoT1) {
  const t = r.tarjetas;
  contar(porId('t1KpiVehiculos'), t.vehiculos, n => cifra(Math.round(n)));
  contar(porId('t1KpiAtencion'), t.atencion, horas);
  contar(porId('t1KpiEspera'), t.espera, horas);
  contar(porId('t1KpiFtct'), t.ftct, horas);
  porId('t1KpiAtencionNota').textContent = t.atencion === null ? 'Sin registros en zona de atención' : `${horasATexto(t.atencion)} en horas y minutos`;
  const ue = opciones?.ultimaEspera ?? null;
  porId('t1KpiEsperaNota').textContent = t.espera !== null ? `${horasATexto(t.espera)} en horas y minutos`
    : ue === null ? 'Falta cargar ESPERA.xlsx' : filtro.desde > ue ? `Sin datos: la espera llega al ${fecha(ue)}` : 'Sin datos de espera con estos filtros';
  porId('t1KpiFtctNota').textContent = t.ftct === null ? 'Sin registros en zona de atención'
    : t.espera === null ? 'Sin espera: queda igual a la atención' : `${horasATexto(t.ftct)} · atención + espera`;
}

function pintarResumen(r: ResultadoT1) {
  const partes = [filtro.desde === filtro.hasta ? fechaLarga(filtro.desde) : `Del ${fecha(filtro.desde)} al ${fecha(filtro.hasta)}`];
  partes.push(r.tarjetas.vehiculos ? `${plural(r.tarjetas.vehiculos, 'vehículo atendido', 'vehículos atendidos')} en zona de atención` : 'sin registros en zona de atención');
  if (r.porCd.length) partes.push(plural(r.porCd.length, 'CD', 'CD'));
  resumenTexto.dataset.tipo = '';
  resumenTexto.textContent = partes.join(' · ');
}

function pintarAviso() {
  const aviso = porId('t1AvisoEspera');
  const ue = opciones?.ultimaEspera ?? null;
  const ver = porId<HTMLButtonElement>('t1AvisoVer');
  if (ue !== null && filtro.hasta <= ue) { aviso.hidden = true; return; }
  aviso.hidden = false;
  if (ue === null) {
    porId('t1AvisoEsperaTexto').textContent = 'Aún no se ha cargado ESPERA.xlsx: la espera sale «—» y el FTCT queda igual a la atención.';
    ver.hidden = true;
    return;
  }
  const texto = porId('t1AvisoEsperaTexto');
  texto.replaceChildren(crear('strong', undefined, `La espera llega hasta el ${fecha(ue)}; sube un ESPERA.xlsx más reciente.`), ' ',
    filtro.desde > ue ? 'En este rango no hay espera: por eso se muestra «—» y el FTCT queda igual a la atención.'
      : `Del ${fecha(ue + 1)} al ${fecha(filtro.hasta)} no hay espera: la espera y el FTCT de este rango solo cuentan hasta el ${fecha(ue)}.`);
  ver.hidden = filtro.desde === Math.max(opciones!.desde ?? ue, primerDiaMes(ue)) && filtro.hasta === ue;
  ver.textContent = `Ver del ${fecha(Math.max(opciones!.desde ?? ue, primerDiaMes(ue)))} al ${fecha(ue)}`;
}
porId('t1AvisoVer').addEventListener('click', verHastaEspera);

const porValor = <T>(valor: (x: T) => number | null) => (a: T, b: T) => (valor(b) ?? -1) - (valor(a) ?? -1);

function pintarGraficos(r: ResultadoT1, rCd: ResultadoT1, rGer: ResultadoT1, rTur: ResultadoT1) {
  const ue = opciones?.ultimaEspera ?? null;
  const vacioEspera = esperaFaltante() ? (ue === null ? 'Aún no se ha cargado ESPERA.xlsx.' : `Sin datos de espera en este rango: la espera llega hasta el ${fecha(ue)}.`) : 'Sin datos de espera con estos filtros.';
  const rango = filtro.desde === filtro.hasta ? fecha(filtro.desde) : `del ${fecha(filtro.desde)} al ${fecha(filtro.hasta)}`;

  ponerCategorias(graficos.diaria, r.diaria.map(d => ({ clave: String(d.fecha), etiqueta: diaCorto(d.fecha), titulo: fechaLarga(d.fecha), valores: [d.atencion, d.espera], x: d.fecha })),
    `${plural(r.diaria.length, 'día', 'días')} · ${rango}`);
  ponerCategorias(graficos.mensual, r.mensual.map(m => ({ clave: m.mes, etiqueta: MES_CORTO[Number(m.mes.slice(5, 7)) - 1], titulo: nombreMes(m.mes), valores: [m.atencion, m.espera] })));

  for (const g of [graficos.cdAtencion, graficos.cdEspera, graficos.cdFtct]) g.seleccion = new Set(filtro.cds);
  graficos.cdEspera.vacio = vacioEspera;
  ponerCategorias(graficos.cdAtencion, [...rCd.porCd].sort(porValor(c => c.atencion)).map(c => ({ clave: c.cd, etiqueta: c.cd, titulo: c.cd, valores: [c.atencion] })),
    `${plural(rCd.porCd.length, 'CD', 'CD')} · de mayor a menor`);
  ponerCategorias(graficos.cdEspera, [...rCd.porCd].sort(porValor(c => c.espera)).map(c => ({ clave: c.cd, etiqueta: c.cd, titulo: c.cd, valores: [c.espera] })),
    `${plural(rCd.porCd.length, 'CD', 'CD')} · de mayor a menor`);
  ponerCategorias(graficos.cdFtct, [...rCd.porCd].sort(porValor(c => c.ftct)).map(c => ({ clave: c.cd, etiqueta: c.cd, titulo: c.cd, valores: [c.atencion, c.espera], total: c.ftct })),
    'Atención + espera · de mayor a menor');

  ponerCategorias(graficos.diaSemana, r.porDiaSemana.map(d => ({ clave: String(d.dia), etiqueta: mayuscula(DIA_CORTO[d.dia]), titulo: mayuscula(DIAS_SEMANA[d.dia]), valores: [d.atencion, d.espera] })),
    'Promedio de lunes a domingo');
  graficos.turno.seleccion = new Set(filtro.turnos);
  ponerCategorias(graficos.turno, rTur.porTurno.map(t => ({ clave: t.turno, etiqueta: `Turno ${t.turno}`, titulo: `Turno ${t.turno} · ${TURNOS.find(x => x.turno === t.turno)!.horas}`, valores: [t.atencion, t.espera] })));
  graficos.gerencia.seleccion = new Set(filtro.gerencias);
  ponerCategorias(graficos.gerencia, [...rGer.porGerencia].sort(porValor(g => g.atencion)).map(g => ({ clave: g.gerencia, etiqueta: g.gerencia, titulo: `Gerencia ${g.gerencia}`, valores: [g.atencion] })),
    `${plural(rGer.porGerencia.length, 'gerencia', 'gerencias')} · de mayor a menor`);
  ponerCategorias(graficos.ol, [...r.porOl].sort(porValor(o => o.atencion)).map(o => ({ clave: o.ol, etiqueta: o.ol, titulo: `OL ${o.ol}`, valores: [o.atencion] })));
  ponerCategorias(graficos.semana, r.porSemana.map(s => {
    const dias = diasDeSemana.get(s.semana);
    return { clave: String(s.semana), etiqueta: `S${s.semana}`, titulo: `Semana ${s.semana}${dias ? ` · ${diaCorto(dias[0])} a ${diaCorto(dias[1])}` : ''}`, valores: [s.atencion] };
  }), `${plural(r.porSemana.length, 'semana', 'semanas')} · todas las zonas`);
}

function pintarMapas(r: ResultadoT1) {
  const [at, es] = mapas;
  at.mapa = r.mapaAtencion;
  es.mapa = r.mapaEspera;
  // Si cambian los días del mapa, se vuelve a la página de los más recientes.
  for (const m of mapas) {
    const clave = m.mapa ? `${m.mapa.fechas[0]}|${m.mapa.fechas[m.mapa.fechas.length - 1]}|${m.mapa.fechas.length}` : '';
    if (clave !== m.fechasClave) { m.fechasClave = clave; m.inicio = null; }
  }
  const sub = (mapa: Mapa) => `${plural(mapa.cds.length, 'CD', 'CD')} × ${plural(mapa.fechas.length, 'día', 'días')} · zona de atención`;
  at.subtitulo.textContent = sub(r.mapaAtencion);
  es.subtitulo.textContent = sub(r.mapaEspera);
  for (const m of mapas) dibujarMapa(m);
}

function pintarTablas(r: ResultadoT1) {
  const ue = opciones?.ultimaEspera ?? null;
  const vacioEspera = esperaFaltante() && ue !== null ? `Sin datos de espera en este rango (la espera llega hasta el ${fecha(ue)}).` : 'Sin registros de espera con estos filtros.';
  ponerFilas(tablas.detAtencion, r.detalleAtencion, 'Sin registros de atención con estos filtros.');
  ponerFilas(tablas.detEspera, r.detalleEspera, vacioEspera);
  ponerFilas(tablas.placaAtencion, r.atencionPorPlaca, 'Sin registros de atención con estos filtros.');
  ponerFilas(tablas.placaEspera, r.esperaPorPlaca, vacioEspera);
  porId('t1TDetAtS').textContent = `${plural(r.detalleAtencion.length, 'registro', 'registros')} · zona de atención`;
  porId('t1TDetEsS').textContent = plural(r.detalleEspera.length, 'registro', 'registros');
}

function pintarExclusiones(r: ResultadoT1) {
  const at = r.exclusionesAtencion.length;
  const es = r.exclusionesEspera.length;
  porId('t1ExclAtCuenta').textContent = plural(at, 'fila', 'filas');
  porId('t1ExclEsCuenta').textContent = plural(es, 'fila', 'filas');
  porId('t1ExclAtCuenta').classList.toggle('t1-alerta', at > 0);
  porId('t1ExclEsCuenta').classList.toggle('t1-alerta', es > 0);
  porId('t1ExclAtNota').textContent = `con atención mayor que ${horas(UMBRAL_EXCLUSION_ATENCION)} h`;
  const ue = opciones?.ultimaEspera ?? null;
  porId('t1ExclEsNota').textContent = !es && esperaFaltante() && ue !== null ? `sin espera en este rango (llega al ${fecha(ue)})` : `con espera mayor que ${horas(UMBRAL_EXCLUSION_ESPERA)} h`;
  porId<HTMLButtonElement>('t1ExclAt').disabled = !at;
  porId<HTMLButtonElement>('t1ExclEs').disabled = !es;
}

function pintar() {
  if (!datos || !opciones) return;
  const r = calcular(paraMotor());
  resultado = r;
  // El gráfico de la dimensión filtrada muestra todas sus barras (con las elegidas resaltadas), como el Power BI.
  const rCd = filtro.cds.length ? calcular(paraMotor('cds')) : r;
  const rGer = filtro.gerencias.length ? calcular(paraMotor('gerencias')) : r;
  const rTur = filtro.turnos.length ? calcular(paraMotor('turnos')) : r;
  pintarResumen(r);
  pintarAviso();
  pintarTarjetas(r);
  pintarGraficos(r, rCd, rGer, rTur);
  pintarMapas(r);
  pintarTablas(r);
  pintarExclusiones(r);
}

let temporizador = 0;
/** Recalcula un instante después (varios clics seguidos se juntan); mientras tanto, lo anterior queda a media luz. */
function recalcular(espera = 140) {
  if (!datos) return;
  document.body.classList.add('t1-calculando');
  clearTimeout(temporizador);
  temporizador = window.setTimeout(() => requestAnimationFrame(() => setTimeout(() => {
    try { pintar(); } catch (error) {
      resumenTexto.dataset.tipo = 'error';
      resumenTexto.textContent = `No se pudo calcular: ${(error as Error).message}`;
    } finally { document.body.classList.remove('t1-calculando'); }
  }, 0)), espera);
}

// ---------- Exclusiones en Excel ----------

function hojaDe(encabezado: string[], filas: (string | number)[][], formatos: Record<number, string>, anchos: number[]) {
  const hoja = XLSX.utils.aoa_to_sheet([encabezado, ...filas]);
  for (let r = 1; r <= filas.length; r++) {
    for (const [c, z] of Object.entries(formatos)) {
      const celda = hoja[XLSX.utils.encode_cell({ r, c: Number(c) })];
      if (celda && celda.t === 'n') celda.z = z;
    }
  }
  hoja['!cols'] = anchos.map(wch => ({ wch }));
  if (hoja['!ref']) hoja['!autofilter'] = { ref: hoja['!ref'] };
  return hoja;
}
const nombreRango = () => `${isoDeDia(filtro.desde)} a ${isoDeDia(filtro.hasta)}`;
function guardarLibro(hoja: XLSX.WorkSheet, nombreHoja: string, archivo: string) {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);
  XLSX.writeFile(libro, archivo, { compression: true });
}

porId('t1ExclAt').addEventListener('click', () => {
  if (!resultado) return;
  const filas = [...resultado.exclusionesAtencion].sort((a, b) => a.fecha - b.fecha || b.horas - a.horas);
  const hoja = hojaDe(
    ['Fecha', 'Registro', 'Placa', 'Ubicación', 'Zona', 'Ingreso', 'Salida', 'Días', 'hh:mm', 'Motivo de exclusion', 'Ingreso real', 'Salida real', 'Tiempo real', 'Comentarios'],
    filas.map((f: FilaAtct) => [f.fecha, f.registro, f.placa, f.ubicacion, f.zona, f.ingreso, f.salida, f.dias, f.minutos / 1440, '', '', '', '', '']),
    { 0: 'd/m/yyyy', 8: 'hh:mm' }, [11, 11, 10, 14, 16, 22, 22, 6, 7, 22, 18, 18, 12, 30]);
  guardarLibro(hoja, 'Exclusiones atención', `Exclusiones atencion ${nombreRango()}.xlsx`);
  anuncio.textContent = `Se descargó el Excel con ${plural(filas.length, 'fila', 'filas')} de atención.`;
});
porId('t1ExclEs').addEventListener('click', () => {
  if (!resultado) return;
  const filas = [...resultado.exclusionesEspera].sort((a, b) => a.enturnamiento - b.enturnamiento);
  const momento = (s: number) => (s > 0 ? s / 86_400 : '');
  const hoja = hojaDe(
    ['Placa', 'Hora programada', 'Enturnamiento', 'Inicio cargue/descargue', 'Fin cargue/descargue', 'Espera', 'Atención', 'FTCT', 'UBI'],
    filas.map((f: FilaEspera) => [f.placa, momento(f.programada), momento(f.enturnamiento), momento(f.inicio), momento(f.fin), f.espera, f.atencionTexto, f.ftct, f.ubi]),
    { 1: 'd/m/yyyy h:mm', 2: 'd/m/yyyy h:mm', 3: 'd/m/yyyy h:mm', 4: 'd/m/yyyy h:mm' }, [10, 16, 16, 22, 20, 8, 9, 8, 14]);
  guardarLibro(hoja, 'Exclusiones espera', `Exclusiones espera ${nombreRango()}.xlsx`);
  anuncio.textContent = `Se descargó el Excel con ${plural(filas.length, 'fila', 'filas')} de espera.`;
});

// ---------- Carga de datos ----------

function pintarCargas() {
  for (const tipo of ['atct', 'espera'] as const) {
    const c = cargas[tipo];
    const caja = porId(tipo === 'atct' ? 't1ArchivoAtct' : 't1ArchivoEspera');
    caja.classList.toggle('t1-archivo-falta', !c);
    caja.querySelector('.t1-archivo-nombre')!.textContent = c ? c.archivo : 'Sin cargar';
    caja.querySelector('.t1-archivo-detalle')!.textContent = c ? `${plural(c.filas, 'fila', 'filas')} · del ${fecha(diaDeIso(c.desde))} al ${fecha(diaDeIso(c.hasta))}` : `Sube ${NOMBRE_TIPO[tipo]}.xlsx para ver ${tipo === 'atct' ? 'la atención' : 'la espera'}.`;
    caja.querySelector('.t1-archivo-quien')!.textContent = c ? `Subido por ${c.usuario_nombre || 'sin nombre'} · ${formatoMomento.format(new Date(c.creado_en))}` : '';
  }
  const fuente = porId('t1HeroDatos');
  fuente.textContent = [cargas.atct && `ATCT al ${fecha(diaDeIso(cargas.atct.hasta))}`, cargas.espera && `ESPERA al ${fecha(diaDeIso(cargas.espera.hasta))}`].filter(Boolean).join(' · ') || 'Sin datos cargados';
}

/** Copia de los datos en el navegador: se vuelven a descargar solo cuando alguien sube un archivo nuevo. */
const ALMACEN_T1 = 't1-datos';
async function pedirDatos<T>(tipo: TipoCarga): Promise<T> {
  const ruta = `/api/t1/datos/${tipo}`;
  const url = `${ruta}?v=${encodeURIComponent(cargas[tipo]?.creado_en ?? '')}`;
  const almacen = 'caches' in window ? await caches.open(ALMACEN_T1).catch(() => null) : null;
  const guardada = await almacen?.match(url).catch(() => undefined);
  if (guardada) {
    try { return await guardada.json() as T; } catch { /* Copia dañada: se descarga de nuevo. */ }
  }
  const respuesta = await fetch(url);
  if (respuesta.status === 401) { location.replace('/'); throw new Error('La sesión terminó.'); }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    throw new Error(cuerpo.error || `No se pudieron consultar los datos de ${NOMBRE_TIPO[tipo]}.`);
  }
  if (almacen) {
    try {
      for (const vieja of await almacen.keys()) if (new URL(vieja.url).pathname === ruta) await almacen.delete(vieja);
      await almacen.put(url, respuesta.clone());
    } catch { /* Sin espacio para la copia: la página funciona igual. */ }
  }
  return respuesta.json() as Promise<T>;
}

function mostrarVacio(sinDatos: boolean) {
  porId('t1Vacio').hidden = !sinDatos;
  tablero.hidden = sinDatos;
  document.querySelector<HTMLElement>('.t1-kpis')!.hidden = sinDatos;
  // Sin datos no hay nada que filtrar: quedan solo el estado y el progreso de la carga.
  document.querySelector<HTMLElement>('.t1-filtros-fila')!.hidden = sinDatos;
  if (sinDatos) porId('t1AvisoEspera').hidden = true;
}

function cargar(): Promise<void> {
  cargando ??= (async () => {
    document.body.classList.add('t1-cargando');
    try {
      const respuesta = await fetch('/api/t1/estado');
      if (respuesta.status === 401) { location.replace('/'); return; }
      const estado = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(estado.error || 'No se pudo consultar Seguimiento T1.');
      cargas = { atct: estado.atct ?? null, espera: estado.espera ?? null };
      pintarCargas();
      if (!cargas.atct) {
        datos = null;
        mostrarVacio(true);
        resumenTexto.dataset.tipo = '';
        resumenTexto.textContent = 'Aún no hay datos: sube ATCT.xlsx y ESPERA.xlsx.';
        return;
      }
      resumenTexto.textContent = `Cargando ${plural(cargas.atct.filas, 'registro', 'registros')} de ATCT${cargas.espera ? ` y ${cifra(cargas.espera.filas)} de ESPERA` : ''}…`;
      const [atct, espera] = await Promise.all([pedirDatos<ColumnasAtct>('atct'), cargas.espera ? pedirDatos<ColumnasEspera>('espera') : Promise.resolve(null)]);
      datos = { atct: filasAtct(atct), espera: espera ? filasEspera(espera) : [] };
      opciones = opcionesT1(datos);
      memoria.clear();
      diasDeSemana = new Map();
      for (const f of datos.atct) {
        const r = diasDeSemana.get(f.semana);
        if (!r) diasDeSemana.set(f.semana, [f.fecha, f.fecha]);
        else { if (f.fecha < r[0]) r[0] = f.fecha; if (f.fecha > r[1]) r[1] = f.fecha; }
      }
      // Las elecciones que ya no existen en los datos nuevos se quitan.
      filtro.cds = filtro.cds.filter(v => opciones!.cds.includes(v));
      filtro.gerencias = filtro.gerencias.filter(v => opciones!.gerencias.includes(v));
      filtro.semanas = filtro.semanas.filter(v => opciones!.semanas.includes(v));
      if (rangoPorDefecto || !filtro.desde) rangoInicial();
      else ponerDentro();
      llenarMeses();
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

// Subir ATCT.xlsx o ESPERA.xlsx: se leen en segundo plano (t1-worker), se suben comprimidos y se recarga la página.
const entradaArchivo = porId<HTMLInputElement>('t1Archivo');
const progreso = porId('t1Progreso');
const progresoTexto = porId('t1ProgresoTexto');
const botonesSubir = ['t1Subir', 't1SubirAbajo', 't1VacioSubir', 't1AvisoSubir'].map(id => porId<HTMLButtonElement>(id));
let subiendo = false;

function avance(texto: string, tipo: '' | 'ok' | 'error' = '') {
  progreso.hidden = false;
  progreso.dataset.tipo = tipo;
  progresoTexto.textContent = texto;
}
function leerEnSegundoPlano(file: File): Promise<RespuestaWorkerT1> {
  return new Promise(resolver => {
    const trabajador = new Worker('/js/t1-worker.js', { type: 'module' });
    trabajador.onmessage = (evento: MessageEvent<RespuestaWorkerT1>) => { trabajador.terminate(); resolver(evento.data); };
    trabajador.onerror = () => { trabajador.terminate(); resolver({ error: 'No se pudo leer el archivo. Verifica que sea el Excel de ATCT o de ESPERA y vuelve a intentar.' }); };
    trabajador.postMessage({ file });
  });
}

async function subir(archivos: File[]) {
  if (subiendo || !archivos.length) return;
  subiendo = true;
  botonesSubir.forEach(b => { b.disabled = true; });
  const listos: string[] = [];
  let problema = '';
  try {
    for (const archivo of archivos) {
      avance(`Leyendo ${archivo.name}…`);
      const lectura = await leerEnSegundoPlano(archivo);
      if (lectura.error || !lectura.tipo || !lectura.gzip) { problema = `${archivo.name}: ${lectura.error ?? 'no se pudo leer.'}`; break; }
      avance(`Subiendo ${archivo.name} · ${plural(lectura.filas ?? 0, 'fila', 'filas')} de ${NOMBRE_TIPO[lectura.tipo]}…`);
      const respuesta = await fetch(`/api/t1/cargar/${lectura.tipo}`, {
        method: 'POST', body: lectura.gzip,
        headers: { 'Content-Type': 'application/octet-stream', 'x-t1-archivo': encodeURIComponent(archivo.name) },
      });
      if (respuesta.status === 401) { location.replace('/'); return; }
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) { problema = `${archivo.name}: ${cuerpo.error || 'no se pudo guardar.'}`; break; }
      const omitidas = lectura.omitidas?.length ?? 0;
      listos.push(`${NOMBRE_TIPO[lectura.tipo]} (${archivo.name}): ${plural(lectura.filas ?? 0, 'fila', 'filas')}${lectura.desde != null && lectura.hasta != null ? `, del ${fecha(lectura.desde)} al ${fecha(lectura.hasta)}` : ''}`
        + (omitidas ? ` · ${omitidas >= 50 ? '50 o más filas' : plural(omitidas, 'fila', 'filas')} sin fecha o tiempo válido se ${omitidas === 1 ? 'omitió' : 'omitieron'} (fila ${lectura.omitidas![0].fila}: ${lectura.omitidas![0].motivo.toLowerCase()})` : ''));
    }
    if (listos.length) {
      avance('Listo. Actualizando la página con los datos nuevos…');
      await cargar();
    }
  } catch (error) {
    problema = error instanceof TypeError ? SIN_CONEXION : (error as Error).message;
  } finally {
    subiendo = false;
    botonesSubir.forEach(b => { b.disabled = false; });
    entradaArchivo.value = '';
  }
  if (problema) avance(`${listos.length ? `Se cargó ${listos.join(' y ')}. ` : ''}No se cargó ${problema}`, 'error');
  else if (listos.length) avance(`Datos actualizados. ${listos.join(' · ')}.`, 'ok');
}
for (const b of botonesSubir) b.addEventListener('click', () => entradaArchivo.click());
entradaArchivo.addEventListener('change', () => void subir([...(entradaArchivo.files ?? [])]));

/** Si alguien sube un archivo mientras la página está abierta, se cargan los datos nuevos sin recargar. */
async function revisarCargasNuevas() {
  if (cargando || document.hidden) return;
  try {
    const respuesta = await fetch('/api/t1/estado');
    if (!respuesta.ok) return;
    const estado = await respuesta.json() as Partial<Cargas>;
    const cambio = (['atct', 'espera'] as const).some(t => (estado[t]?.creado_en ?? null) !== (cargas[t]?.creado_en ?? null));
    if (cambio && !cargando) await cargar();
  } catch { /* Sin conexión: se intenta en la próxima revisión. */ }
}
setInterval(() => void revisarCargasNuevas(), 120_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void revisarCargasNuevas(); });

/** Las tarjetas se animan cuando llegan a la pantalla (no todas al cargar, cuando las de abajo no se ven). */
function activarAparicion() {
  if (sinMovimiento.matches || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('t1-revelar');
  const observador = new IntersectionObserver(entradas => {
    let orden = 0;
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      const el = entrada.target as HTMLElement;
      el.style.setProperty('--d', String(orden++));
      el.classList.add('t1-visible');
      observador.unobserve(el);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
  for (const el of document.querySelectorAll<HTMLElement>('.t1-anima')) observador.observe(el);
}
activarAparicion();

void cargar();

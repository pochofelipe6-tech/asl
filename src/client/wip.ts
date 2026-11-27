// Módulo Seguimiento WIP: réplica de la página "Seguimiento WIP" del Power BI "Seguimiento ATCT".
// Trae del servidor la última carga de Data WIP.xlsx (en columnas) y calcula TODO en el navegador con src/shared/wip.ts
// (las reglas del Power BI viven allí; aquí solo se dibuja). Al cambiar un filtro se recalcula.
// Muestra 4 tarjetas, 6 gráficos en SVG propio (cada uno con "Ver tabla"), la tabla por CD, la tabla por día, el mapa de
// calor por CD y día y la carga de archivos nuevos. Misma familia visual que Seguimiento T1 (usa t1.css). Tema, usuario
// y salida: modulos.ts.
import { porId } from './dom';
import { DIAS_SEMANA, MESES, diaDeIso, fechaDeDia, isoDeDia } from '../shared/t1';
import { calcularWip, filasWip, opcionesWip } from '../shared/wip';
import type { ColumnasWip, FilaWip, FiltrosWip, ResultadoWip, Usabilidades } from '../shared/wip';
import type { RespuestaWorkerCargas } from './cargas-worker';

const SVG = 'http://www.w3.org/2000/svg';
const SIN_CONEXION = 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Formatos ----------

const cifra = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
const formatoPct = new Intl.NumberFormat('es-CO', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatoPctEje = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 });
/** Porcentaje con 1 decimal ("97,1 %"), o "—" si no hay dato (usabilidad vacía). */
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : formatoPct.format(n));
/** Porcentaje corto para las celdas del mapa ("97,1"; "100" si es completo). */
/** Celda del mapa por CD y día: porcentaje entero, como el Power BI ("91 %"); la ventanita lleva el decimal. */
const pctCelda = (n: number) => `${Math.round(n * 100)} %`;
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
const primerDiaMes = (dia: number) => diaDeIso(`${mesDeDia(dia)}-01`);
const formatoMomento = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
const porTexto = new Intl.Collator('es', { numeric: true }).compare;

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

type Medida = 'armado' | 'verificacion' | 'montacargas';
interface Filtro { desde: number; hasta: number; cds: string[] }
/** Lo guardado de un tipo: filas y fechas de todos los archivos juntos; archivo, quién y cuándo son del último que se subió. */
interface Carga { archivo: string; filas: number; desde: string; hasta: string; usuario_nombre: string | null; creado_en: string; cargas?: number }
type OpcionesWip = ReturnType<typeof opcionesWip>;

/** Las tres usabilidades, cada una con su color (el mismo en las tarjetas, las tablas y las líneas). */
const MEDIDAS: readonly { clave: Medida; nombre: string; clase: string }[] = [
  { clave: 'armado', nombre: 'Armado', clase: 'wip-c-ar' },
  { clave: 'verificacion', nombre: 'Verificación', clase: 'wip-c-ve' },
  { clave: 'montacargas', nombre: 'Montacargas', clase: 'wip-c-mo' },
];

let filas: FilaWip[] | null = null;
let opciones: OpcionesWip | null = null;
let carga: Carga | null = null;
let resultado: ResultadoWip | null = null;
/** Primer y último día de cada semana (para nombrarlas en el gráfico semanal). */
let diasDeSemana = new Map<number, [number, number]>();
const filtro: Filtro = { desde: 0, hasta: 0, cds: [] };
/** "Filtro tendencias" del Power BI: qué líneas se ven en el gráfico de usabilidad por día. */
const tendencias = new Set<Medida>(MEDIDAS.map(m => m.clave));
/** Usabilidad que pinta el mapa de calor. */
let medidaMapa: Medida = 'armado';
/** Mientras el usuario no toque las fechas, una carga nueva vuelve a poner el mes de la última fecha. */
let rangoPorDefecto = true;
let cargando: Promise<void> | null = null;

const anuncio = porId('wipAnuncio');
const resumenTexto = porId('wipResumen');
const tablero = porId('wipTablero');
const campoDesde = porId<HTMLInputElement>('wipDesde');
const campoHasta = porId<HTMLInputElement>('wipHasta');
const campoMes = porId<HTMLSelectElement>('wipMes');

const memoria = new Map<string, ResultadoWip>();
function calcular(f: FiltrosWip): ResultadoWip {
  const clave = JSON.stringify(f);
  let r = memoria.get(clave);
  if (!r) {
    r = calcularWip(filas!, f);
    if (memoria.size > 16) memoria.delete(memoria.keys().next().value!);
    memoria.set(clave, r);
  }
  return r;
}

// ---------- Ventanita de detalle (puntero o teclado) ----------

const tip = porId('wipTip');
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

// ---------- Meta y semáforo de usabilidad (formato condicional del Power BI) ----------

/** Meta de usabilidad (la del Power BI): 99 % o más va en verde; menos, en rojo. */
const META_USABILIDAD = 0.99;
/** Porcentaje entero, como lo muestran las tarjetas del Power BI ("97 %"). */
const pctEntero = (n: number) => `${Math.round(n * 100)} %`;
type NivelUso = 'ok' | 'bajo';
/** Colores del Power BI: verde #5FF74B y rojo #F6563A. */
const COLOR_USO: Record<NivelUso, string> = { ok: '#5FF74B', bajo: '#F6563A' };
/** Verde de 99 % a menos de 200 %; rojo por debajo de 99 %. En las tablas, verificación y montacargas en 0 % quedan
 *  sin color (la regla del Power BI pide más de 0); el armado sí se pinta desde 0 %. */
function nivelUso(v: number | null, ceroSinColor = false): NivelUso | null {
  if (v === null || v < 0) return null;
  if (v >= META_USABILIDAD) return v < 2 ? 'ok' : null;
  return ceroSinColor && v === 0 ? null : 'bajo';
}
const colorUso = (v: number | null, ceroSinColor = false) => { const n = nivelUso(v, ceroSinColor); return n ? COLOR_USO[n] : null; };

// ---------- Gráficos (líneas y columnas) ----------

type Formato = 'pct' | 'cifra';
interface Serie { nombre: string; clase: string }
const SERIES_USO: Record<Medida, Serie> = {
  armado: { nombre: 'Usabilidad Armado', clase: 'wip-c-ar' },
  verificacion: { nombre: 'Usabilidad Verificación', clase: 'wip-c-ve' },
  montacargas: { nombre: 'Usabilidad Montacargas', clase: 'wip-c-mo' },
};
const WIP: Serie = { nombre: 'Usabilidad WIP', clase: 't1-c-at' };
const FINALIZADOS: Serie = { nombre: 'Finalizados', clase: 'wip-c-fin' };
const TOTAL_DTS: Serie = { nombre: 'Total DTs', clase: 'wip-c-tot' };
interface Categoria {
  clave: string; etiqueta: string; titulo: string; valores: (number | null)[];
  /** Posición en el eje (día de Excel o semana) para las líneas. */
  x?: number;
  /** Filas de más para la ventanita (p. ej. las tres usabilidades de un CD). */
  notas?: FilaTip[];
}
interface Grafico {
  caja: HTMLElement; subtitulo: HTMLElement | null; nombre: string; forma: 'linea' | 'columnas'; formato: Formato;
  series: Serie[]; categorias: Categoria[]; encabezado: string;
  /** Con dimensión, un clic en una columna filtra la página por ella (cruce de filtros del Power BI). */
  dimension: 'cds' | null; seleccion: Set<string>;
  /** false si la leyenda ya está a la vista en otro control (los botones de tendencia). */
  leyenda: boolean;
  /** Alto del área de las líneas: proporción del ancho y tope en píxeles. */
  proporcion: number; altoMax: number;
  vacio: string; enTabla: boolean; ancho: number; foco: number;
  /** Alto de la caja al dibujarlo (los que llenan su tarjeta se redibujan si cambia). */
  alto: number;
  /** Columnas (o puntos) en verde o rojo según la meta de usabilidad. */
  semaforo: boolean;
  /** Cifra sobre cada columna en porcentaje entero ("99 %"), como el Power BI. */
  entera: boolean;
  /** Líneas de meta (verdes punteadas, como en el Power BI). */
  metas: { nombre: string; valor: number }[];
}
function nuevoGrafico(caja: string, subtitulo: string | null, nombre: string, forma: Grafico['forma'], formato: Formato, series: Serie[], encabezado: string, extra: Partial<Grafico> = {}): Grafico {
  return {
    caja: porId(caja), subtitulo: subtitulo ? porId(subtitulo) : null, nombre, forma, formato, series, categorias: [], encabezado,
    dimension: null, seleccion: new Set(), leyenda: true, proporcion: 0.3, altoMax: 290, vacio: 'Sin registros con estos filtros.', enTabla: false, ancho: 0, alto: 0, foco: 0, semaforo: false, entera: false, metas: [], ...extra,
  };
}
const graficos: Record<string, Grafico> = {
  // Comparte fila con la tabla por CD (14 filas): un poco más alto para llenar la tarjeta.
  dia: nuevoGrafico('wipGDia', 'wipGDiaS', 'Seguimiento usabilidad de WIP por día', 'linea', 'pct', MEDIDAS.map(m => SERIES_USO[m.clave]), 'Fecha', { leyenda: false, proporcion: 0.2, altoMax: 200, metas: [{ nombre: 'Meta 100 %', valor: 1 }] }),
  dts: nuevoGrafico('wipGDts', 'wipGDtsS', 'Seguimiento cargue de DTs por día', 'linea', 'cifra', [FINALIZADOS, TOTAL_DTS], 'Fecha', { proporcion: 0.19, altoMax: 185 }),
  cd: nuevoGrafico('wipGCd', 'wipGCdS', 'Porcentaje de usabilidad WIP por CD', 'columnas', 'pct', [WIP], 'CD', { dimension: 'cds', altoMax: 215, semaforo: true }),
  gerencia: nuevoGrafico('wipGGer', 'wipGGerS', 'Porcentaje de usabilidad WIP por gerencia', 'columnas', 'pct', [WIP], 'Gerencia', { semaforo: true, entera: true }),
  ol: nuevoGrafico('wipGOl', null, 'Porcentaje de usabilidad WIP por OL', 'columnas', 'pct', [WIP], 'OL', { semaforo: true, entera: true }),
  semana: nuevoGrafico('wipGSem', 'wipGSemS', 'Porcentaje de usabilidad WIP por semana', 'linea', 'pct', [WIP], 'Semana', { proporcion: 0.24, altoMax: 175, semaforo: true }),
};

/** Marcas "redondas" del eje (unas 4 o 5) desde un piso hasta cubrir el tope. */
function marcasEje(tope: number, piso = 0): number[] {
  const alto = Math.max(tope, piso + 1e-6);
  const bruto = (alto - piso) / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map(f => f * potencia).find(p => p >= bruto) ?? 10 * potencia;
  const marcas = [Number((Math.floor(piso / paso + 1e-9) * paso).toFixed(6))];
  while (marcas[marcas.length - 1] < alto - 1e-9) marcas.push(Number((marcas[marcas.length - 1] + paso).toFixed(6)));
  return marcas;
}
const valorDe = (g: Grafico, v: number | null) => (g.formato === 'pct' ? pct(v) : v === null ? '—' : cifra(v));
const ejeDe = (g: Grafico, v: number) => (g.formato === 'pct' ? formatoPctEje.format(v) : cifra(v));
/** Ancho aproximado de un texto (Segoe UI, seminegrita). */
const anchoTexto = (texto: string, tamano = 11.5) => texto.length * tamano * 0.585;
const hayDatos = (g: Grafico) => g.categorias.some(c => c.valores.some(v => v !== null));
const sinSerie = (g: Grafico, k: number) => g.categorias.every(c => c.valores[k] === null);
/** Clase de color de una columna o punto: la del semáforo si el gráfico lo tiene, o la de su serie. */
const claseDe = (g: Grafico, k: number, v: number | null) => { const n = g.semaforo ? nivelUso(v) : null; return n ? `wip-sem-${n}` : g.series[k].clase; };

function filasTip(g: Grafico, c: Categoria): FilaTip[] {
  const filasDe: FilaTip[] = g.series.map((s, k) => ({ nombre: s.nombre, valor: c.valores[k] === null ? 'Sin datos' : valorDe(g, c.valores[k]), clase: claseDe(g, k, c.valores[k]), fuerte: g.series.length === 1 }));
  return c.notas ? [...filasDe, ...c.notas] : filasDe;
}
function textoCategoria(g: Grafico, c: Categoria): string {
  return `${c.titulo}: ${g.series.map((s, k) => `${s.nombre} ${c.valores[k] === null ? 'sin datos' : valorDe(g, c.valores[k])}`).join(', ')}`;
}
function pistaDe(g: Grafico, c: Categoria): string | undefined {
  if (!g.dimension) return undefined;
  return g.seleccion.has(c.clave) ? 'Clic para quitar este filtro' : 'Clic para filtrar toda la página';
}

function leyendaDe(g: Grafico): HTMLElement | null {
  const items: HTMLElement[] = [];
  if (g.semaforo) {
    for (const [nivel, texto] of [['ok', `${pctEntero(META_USABILIDAD)} o más`], ['bajo', `Menos de ${pctEntero(META_USABILIDAD)}`]] as const) {
      const li = crear('li');
      li.append(crear('i', `t1-muestra wip-sem-${nivel}`), texto);
      items.push(li);
    }
  } else if (g.series.length > 1 && g.leyenda) {
    for (const [k, s] of g.series.entries()) {
      const li = crear('li');
      li.append(crear('i', `t1-muestra ${g.forma === 'linea' ? 't1-muestra-linea ' : ''}${s.clase}`), s.nombre);
      if (sinSerie(g, k)) li.append(crear('span', 't1-leyenda-nota', '· sin datos'));
      items.push(li);
    }
  }
  for (const m of g.metas) {
    const li = crear('li');
    li.append(crear('i', 't1-muestra t1-muestra-meta wip-muestra-meta'), m.nombre);
    items.push(li);
  }
  if (!items.length) return null;
  const lista = crear('ul', 't1-leyenda');
  lista.setAttribute('aria-label', 'Convenciones');
  lista.append(...items);
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
  [g.encabezado, ...g.series.map(s => s.nombre)].forEach((texto, i) => {
    const th = crear('th', i ? 'num' : undefined, texto);
    th.scope = 'col';
    cabeza.append(th);
  });
  const cuerpo = tabla.createTBody();
  for (const c of g.categorias) {
    const fila = cuerpo.insertRow();
    const th = crear('th', undefined, c.titulo);
    th.scope = 'row';
    fila.append(th, ...c.valores.map(v => crear('td', 'num', valorDe(g, v))));
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
    else if ((evento.key === 'Enter' || evento.key === ' ') && g.dimension) { evento.preventDefault(); alternarCd(g.categorias[g.foco].clave); }
  });
}
function etiquetaAccesible(g: Grafico, unidad: string, ayuda: string): string {
  const n = g.categorias.length;
  const medida = g.formato === 'pct' ? 'en porcentaje' : 'en número de DTs';
  return `${g.nombre}, ${medida}. ${n === 1 ? `Un ${unidad}` : `${n} ${unidad}s`}. ${ayuda} ${g.categorias.slice(0, 16).map(c => textoCategoria(g, c)).join('. ')}`;
}

/** Columnas de una serie (por CD, gerencia y OL). El valor va sobre cada columna si cabe; si los nombres no caben, se inclinan.
 *  "extra": alto que sobra en la tarjeta; las columnas crecen para llenarlo (con tope). */
function dibujarColumnas(g: Grafico, ancho: number, extra = 0): SVGSVGElement {
  const n = g.categorias.length;
  const maximo = Math.max(...g.categorias.flatMap(c => c.valores).map(v => v ?? 0));
  const marcas = marcasEje(g.formato === 'pct' ? Math.max(1, maximo) : maximo * 1.05);
  const tope = marcas[marcas.length - 1];
  const etiquetasEje = marcas.map(m => ejeDe(g, m));
  const IZQUIERDA = Math.round(Math.max(...etiquetasEje.map(t => anchoTexto(t))) + 14);
  const DERECHA = 8;
  const ARRIBA = 22;
  const largo = Math.max(60, ancho - IZQUIERDA - DERECHA);
  const hueco = largo / n;
  const grosor = Math.max(3, Math.min(40, hueco * 0.56));
  const ALTO = Math.round(Math.min(g.altoMax, Math.max(140, ancho * 0.22)) + Math.min(extra, 220));
  // Nombres: derechos si caben; si no, inclinados 40° (y si aun así se pisan, uno sí y otro no).
  const masAncha = Math.max(...g.categorias.map(c => anchoTexto(c.etiqueta)));
  const inclinar = masAncha + 10 > hueco;
  const SENO = 0.643;
  const ABAJO = inclinar ? Math.round(Math.min(masAncha, 140) * SENO + 24) : 30;
  const saltar = inclinar ? Math.max(1, Math.ceil(13 / (hueco * SENO))) : 1;
  const base = ARRIBA + ALTO;
  const altoTotal = base + ABAJO;
  const yDe = (v: number) => base - (v / tope) * ALTO;
  const filtra = !!g.dimension;
  const svg = nodo('svg', { width: ancho, height: altoTotal, viewBox: `0 0 ${ancho} ${altoTotal}`, class: `t1-svg${filtra ? ' t1-filtra' : ''}${g.seleccion.size ? ' t1-con-seleccion' : ''}`, tabindex: 0, role: 'img' });
  svg.setAttribute('aria-label', etiquetaAccesible(g, 'columna', `Usa las flechas para leer cada una${filtra ? ' y Enter para filtrar la página' : ''}.`));
  marcas.forEach((m, i) => {
    const y = yDe(m);
    svg.append(nodo('line', { x1: IZQUIERDA, x2: ancho - DERECHA, y1: y, y2: y, class: m ? 't1-guia' : 't1-base' }));
    svg.append(nodo('text', { x: IZQUIERDA - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 't1-eje' }, etiquetasEje[i]));
  });
  // Cifra sobre la columna: entera ("99 %") en gerencia y OL, como el Power BI; la ventanita y la tabla llevan el decimal.
  const cifraCol = (v: number) => (g.entera ? pctEntero(v) : valorDe(g, v));
  const caben = g.categorias.every(c => c.valores.every(v => v === null || anchoTexto(cifraCol(v), 11) <= hueco - 4));
  const columnas: SVGGElement[] = [];
  g.categorias.forEach((c, i) => {
    const centro = IZQUIERDA + hueco * (i + 0.5);
    const elegida = g.seleccion.has(c.clave);
    const grupo = nodo('g', { class: `t1-marca${elegida ? ' t1-elegida' : ''}${g.seleccion.size && !elegida ? ' t1-atenuada' : ''}`, style: `--i:${i}` });
    grupo.append(nodo('rect', { x: IZQUIERDA + hueco * i + 1, y: ARRIBA - 18, width: Math.max(1, hueco - 2), height: ALTO + 18 + ABAJO - 4, rx: 6, class: 't1-zona' }));
    const v = c.valores[0];
    const x = centro - grosor / 2;
    if (v !== null) {
      const alto = (v / tope) * ALTO;
      if (alto > 0.5) {
        const r = Math.min(4, grosor / 2, alto);
        const barra = nodo('g', { class: 't1-barra-v' });
        barra.append(nodo('path', { class: `t1-parte ${claseDe(g, 0, v)}`, d: `M${x} ${base}V${base - alto + r}a${r} ${r} 0 0 1 ${r} ${-r}h${grosor - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${base}z` }));
        grupo.append(barra);
      }
      if (caben) grupo.append(nodo('text', { x: centro, y: yDe(v) - 6, 'text-anchor': 'middle', class: 't1-cifra t1-cifra-col' }, cifraCol(v)));
    } else if (caben) {
      grupo.append(nodo('text', { x: centro, y: base - 6, 'text-anchor': 'middle', class: 't1-cifra t1-cifra-col t1-cifra-nula' }, '—'));
    }
    if (i % saltar === 0) {
      const clase = `t1-eje t1-eje-x${elegida ? ' t1-eje-elegido' : ''}`;
      grupo.append(inclinar
        ? nodo('text', { x: centro + 4, y: base + 14, 'text-anchor': 'end', transform: `rotate(-40 ${centro + 4} ${base + 14})`, class: clase }, c.etiqueta)
        : nodo('text', { x: centro, y: base + 18, 'text-anchor': 'middle', class: clase }, c.etiqueta));
    }
    const mostrar = (cx: number, cy: number) => {
      svg.classList.add('t1-enfoque');
      columnas.forEach((col, j) => col.classList.toggle('t1-activa', j === i));
      mostrarTip(c.titulo, filasTip(g, c), cx, cy, pistaDe(g, c));
    };
    grupo.addEventListener('pointermove', evento => { g.foco = i; mostrar(evento.clientX, evento.clientY); });
    grupo.addEventListener('pointerleave', () => { svg.classList.remove('t1-enfoque'); grupo.classList.remove('t1-activa'); ocultarTip(); });
    if (filtra) grupo.addEventListener('click', () => alternarCd(c.clave));
    (grupo as SVGGElement & { mostrar?: () => void }).mostrar = () => {
      const caja = svg.getBoundingClientRect();
      mostrar(caja.left + centro, caja.top + yDe(v ?? 0));
    };
    columnas.push(grupo);
    svg.append(grupo);
  });
  conTeclado(g, svg, n, i => (columnas[i] as SVGGElement & { mostrar?: () => void }).mostrar?.(), () => { svg.classList.remove('t1-enfoque'); columnas.forEach(col => col.classList.remove('t1-activa')); });
  return svg;
}

/** Si las columnas quedarían muy angostas (celular, 14 CD), se dibujan como barras horizontales: así se leen todos los nombres. */
const usarBarras = (g: Grafico, ancho: number) => (ancho - 50) / g.categorias.length < 30;

/** Barras horizontales de una serie; el valor va en la punta de cada barra. */
function dibujarBarras(g: Grafico, ancho: number): SVGSVGElement {
  const n = g.categorias.length;
  const FILA = 30;
  const GROSOR = 16;
  const IZQUIERDA = Math.round(Math.min(ancho * 0.42, Math.max(...g.categorias.map(c => anchoTexto(c.etiqueta, 12.5))) + 22));
  const DERECHA = Math.round(Math.max(...g.categorias.map(c => anchoTexto(valorDe(g, c.valores[0])))) + 14);
  const ARRIBA = 4;
  const alto = ARRIBA * 2 + n * FILA;
  const maximo = Math.max(...g.categorias.map(c => c.valores[0] ?? 0));
  const tope = g.formato === 'pct' ? Math.max(1, maximo) : Math.max(maximo, 1e-6);
  const largo = Math.max(40, ancho - IZQUIERDA - DERECHA);
  const filtra = !!g.dimension;
  const svg = nodo('svg', { width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}`, class: `t1-svg${filtra ? ' t1-filtra' : ''}${g.seleccion.size ? ' t1-con-seleccion' : ''}`, tabindex: 0, role: 'img' });
  svg.setAttribute('aria-label', etiquetaAccesible(g, 'barra', `Usa las flechas para leer cada una${filtra ? ' y Enter para filtrar la página' : ''}.`));
  svg.append(nodo('line', { x1: IZQUIERDA, x2: IZQUIERDA, y1: 0, y2: alto, class: 't1-base' }));
  const marcas: SVGGElement[] = [];
  g.categorias.forEach((c, i) => {
    const y0 = ARRIBA + i * FILA;
    const centro = y0 + FILA / 2;
    const top = centro - GROSOR / 2;
    const elegida = g.seleccion.has(c.clave);
    const grupo = nodo('g', { class: `t1-marca${elegida ? ' t1-elegida' : ''}${g.seleccion.size && !elegida ? ' t1-atenuada' : ''}`, style: `--i:${i}` });
    grupo.append(nodo('rect', { x: 0, y: y0 + 1, width: ancho, height: FILA - 2, rx: 6, class: 't1-zona' }));
    grupo.append(nodo('text', { x: IZQUIERDA - 10, y: centro, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 't1-eje t1-eje-cat' }, c.etiqueta));
    const v = c.valores[0];
    const w = v === null ? 0 : (v / tope) * largo;
    if (w > 0.5) {
      const r = Math.min(4, GROSOR / 2, w);
      const barra = nodo('g', { class: 't1-barra' });
      barra.append(nodo('path', { class: `t1-parte ${claseDe(g, 0, v)}`, d: `M${IZQUIERDA} ${top}H${IZQUIERDA + w - r}a${r} ${r} 0 0 1 ${r} ${r}V${top + GROSOR - r}a${r} ${r} 0 0 1 ${-r} ${r}H${IZQUIERDA}z` }));
      grupo.append(barra);
    }
    grupo.append(nodo('text', { x: IZQUIERDA + w + 7, y: centro, 'dominant-baseline': 'central', class: `t1-cifra${v === null ? ' t1-cifra-nula' : ''}` }, valorDe(g, v)));
    const mostrar = (cx: number, cy: number) => {
      svg.classList.add('t1-enfoque');
      marcas.forEach((m, k) => m.classList.toggle('t1-activa', k === i));
      mostrarTip(c.titulo, filasTip(g, c), cx, cy, pistaDe(g, c));
    };
    grupo.addEventListener('pointermove', evento => { g.foco = i; mostrar(evento.clientX, evento.clientY); });
    grupo.addEventListener('pointerleave', () => { svg.classList.remove('t1-enfoque'); grupo.classList.remove('t1-activa'); ocultarTip(); });
    if (filtra) grupo.addEventListener('click', () => alternarCd(c.clave));
    (grupo as SVGGElement & { mostrar?: () => void }).mostrar = () => {
      const caja = svg.getBoundingClientRect();
      mostrar(caja.left + IZQUIERDA + w, caja.top + top);
    };
    marcas.push(grupo);
    svg.append(grupo);
  });
  conTeclado(g, svg, n, i => (marcas[i] as SVGGElement & { mostrar?: () => void }).mostrar?.(), () => { svg.classList.remove('t1-enfoque'); marcas.forEach(m => m.classList.remove('t1-activa')); });
  return svg;
}

/** Líneas de 2 px con un punto por día o semana; una línea vertical sigue al puntero y la ventanita lee todas las series.
 *  Los porcentajes altos (casi siempre cerca de 100 %) no arrancan en 0: así se ven las diferencias. */
function dibujarLinea(g: Grafico, ancho: number): SVGSVGElement {
  const n = g.categorias.length;
  const valores = g.categorias.flatMap(c => c.valores).filter((v): v is number => v !== null);
  // El eje llega al menos hasta la meta más alta, para que siempre se vea.
  const mayor = Math.max(...valores, ...g.metas.map(m => m.valor));
  const menor = Math.min(...valores);
  let marcas: number[];
  if (g.formato === 'pct' && menor >= 0.4) {
    const piso = Math.max(0, menor - Math.max(0.02, (mayor - menor) * 0.25));
    marcas = marcasEje(Math.min(Math.max(mayor, piso + 0.05), Math.max(1, mayor)), piso);
  } else marcas = marcasEje(g.formato === 'pct' ? Math.max(mayor, 0.05) : Math.max(mayor * 1.05, 1));
  const piso = marcas[0];
  const tope = marcas[marcas.length - 1];
  const etiquetasEje = marcas.map(m => ejeDe(g, m));
  const IZQUIERDA = Math.round(Math.max(...etiquetasEje.map(t => anchoTexto(t))) + 14);
  const finales = g.series.map((_, k) => { for (let i = n - 1; i >= 0; i--) if (g.categorias[i].valores[k] !== null) return i; return -1; });
  const DERECHA = Math.round(Math.max(42, ...finales.map((i, k) => (i < 0 ? 0 : anchoTexto(valorDe(g, g.categorias[i].valores[k])) + 14))));
  const ARRIBA = 14;
  const ALTO = Math.round(Math.min(g.altoMax, Math.max(Math.min(150, g.altoMax), ancho * g.proporcion)));
  const ABAJO = 30;
  const base = ARRIBA + ALTO;
  const altoTotal = base + ABAJO;
  const largo = Math.max(60, ancho - IZQUIERDA - DERECHA);
  const yDe = (v: number) => base - ((v - piso) / (tope - piso)) * ALTO;
  const continuo = n > 1 && g.categorias.every(c => c.x !== undefined);
  const x0 = g.categorias[0].x ?? 0;
  const x1 = g.categorias[n - 1].x ?? 0;
  const xDe = (i: number) => (continuo ? IZQUIERDA + 10 + ((g.categorias[i].x! - x0) / (x1 - x0)) * (largo - 20) : IZQUIERDA + (largo / n) * (i + 0.5));
  const svg = nodo('svg', { width: ancho, height: altoTotal, viewBox: `0 0 ${ancho} ${altoTotal}`, class: 't1-svg t1-svg-linea', tabindex: 0, role: 'img' });
  svg.setAttribute('aria-label', etiquetaAccesible(g, 'punto', 'Usa las flechas izquierda y derecha para leer cada uno.'));
  marcas.forEach((m, i) => {
    const y = yDe(m);
    svg.append(nodo('line', { x1: IZQUIERDA, x2: ancho - DERECHA + 8, y1: y, y2: y, class: i ? 't1-guia' : 't1-base' }));
    svg.append(nodo('text', { x: IZQUIERDA - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 't1-eje' }, etiquetasEje[i]));
  });
  // Metas: línea verde punteada de lado a lado; el nombre va encima (se agrega al final, para que nada lo tape).
  const nombresMeta = g.metas.map(m => {
    const y = yDe(m.valor);
    svg.append(nodo('line', { x1: IZQUIERDA, x2: ancho - DERECHA + 8, y1: y, y2: y, class: 'wip-meta' }));
    return nodo('text', { x: IZQUIERDA + 4, y: y - 5, class: 'wip-meta-texto' }, m.nombre.toUpperCase());
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
      puntos.append(nodo('circle', { cx: xDe(i), cy: yDe(v), r: 4, class: `t1-punto ${claseDe(g, k, v)}` }));
    });
    svg.append(puntos);
    // Cifra al final de cada línea (si no choca con la de otra línea).
    const ultimo = finales[k];
    const y = yDe(g.categorias[ultimo].valores[k]!);
    if (!cifrasFinales.some(u => Math.abs(u - y) < 15)) {
      cifrasFinales.push(y);
      svg.append(nodo('text', { x: xDe(ultimo) + 8, y, 'dominant-baseline': 'central', class: 't1-cifra t1-cifra-final' }, valorDe(g, g.categorias[ultimo].valores[k])));
    }
  });
  svg.append(...nombresMeta);
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
      if (v !== null) { f.setAttribute('cx', String(x)); f.setAttribute('cy', String(yDe(v))); f.setAttribute('class', `t1-punto t1-punto-foco ${claseDe(g, k, v)}`); }
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

function dibujar(g: Grafico, animar = true) {
  const ancho = Math.floor(g.caja.clientWidth);
  g.ancho = ancho;
  g.caja.classList.toggle('t1-quieto', !animar);
  if (g.caja.contains(document.querySelector('.t1-activa'))) ocultarTip();
  if (!hayDatos(g)) { g.caja.replaceChildren(crear('p', 't1-grafico-vacio', g.vacio)); return; }
  if (g.enTabla) { g.caja.replaceChildren(tablaDe(g)); return; }
  if (!ancho) return; // Oculto: se dibuja al mostrarse (ResizeObserver).
  const columnas = g.forma === 'columnas' && !usarBarras(g, ancho);
  const svg = g.forma === 'linea' ? dibujarLinea(g, ancho) : columnas ? dibujarColumnas(g, ancho) : dibujarBarras(g, ancho);
  const leyenda = leyendaDe(g);
  g.caja.replaceChildren(...(leyenda ? [leyenda, svg] : [svg]));
  // Por CD: la fila la estira la tabla por día, más alta; las columnas crecen hasta llenar la tarjeta (sin hueco abajo).
  if (columnas && g.caja.classList.contains('t1-llena')) {
    const sobra = sobraAbajo(g, svg);
    if (sobra > 2) svg.replaceWith(dibujarColumnas(g, ancho, sobra));
    g.alto = g.caja.clientHeight;
  }
}

/** Alto libre bajo el gráfico, si una tarjeta fija de su misma fila (una tabla) la estira. Entre dos gráficos que se
 *  llenan no se mide: uno sostendría al otro y la fila ya no volvería a encogerse. */
function sobraAbajo(g: Grafico, svg: SVGSVGElement): number {
  const tarjeta = g.caja.closest<HTMLElement>('.t1-card');
  const fila = tarjeta?.parentElement;
  if (!tarjeta || !fila) return 0;
  const conFija = [...fila.children].some(t => t !== tarjeta && t instanceof HTMLElement && t.offsetTop === tarjeta.offsetTop && !t.querySelector('.t1-llena'));
  return conFija ? Math.floor(g.caja.getBoundingClientRect().bottom - svg.getBoundingClientRect().bottom) : 0;
}

function ponerCategorias(g: Grafico, categorias: Categoria[], subtitulo?: string, animar = true) {
  g.categorias = categorias;
  g.foco = Math.min(g.foco, Math.max(0, categorias.length - 1));
  if (g.subtitulo && subtitulo !== undefined) g.subtitulo.textContent = subtitulo;
  dibujar(g, animar);
}

for (const g of Object.values(graficos)) {
  let cuadro = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(cuadro);
    cuadro = requestAnimationFrame(() => {
      // Los que llenan su tarjeta también se redibujan si la fila cambió de alto (p. ej. otra página de la tabla).
      const altoCambio = g.caja.classList.contains('t1-llena') && !!g.caja.querySelector(':scope > svg') && Math.abs(g.caja.clientHeight - g.alto) > 2;
      if (Math.floor(g.caja.clientWidth) !== g.ancho || altoCambio) dibujar(g, false);
    });
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

// ---------- "Tendencia": qué líneas se ven en el gráfico por día ----------

const tendenciasCaja = porId('wipTendencias');
for (const m of MEDIDAS) {
  const b = crear('button', 'wip-tend');
  b.type = 'button';
  b.dataset.medida = m.clave;
  b.setAttribute('aria-pressed', 'true');
  b.append(crear('i', `wip-tend-muestra ${m.clase}`), crear('span', undefined, m.nombre), icono('m6.5 12.5 3.5 3.5 7.5-8'));
  b.addEventListener('click', () => {
    if (tendencias.has(m.clave)) tendencias.delete(m.clave); else tendencias.add(m.clave);
    pintarTendencias();
    anuncio.textContent = `${tendencias.has(m.clave) ? 'Se muestra' : 'Se ocultó'} la tendencia de ${m.nombre.toLowerCase()}.`;
    if (resultado) pintarDia(resultado, false);
  });
  tendenciasCaja.append(b);
}
function pintarTendencias() {
  for (const b of tendenciasCaja.querySelectorAll<HTMLButtonElement>('.wip-tend')) b.setAttribute('aria-pressed', String(tendencias.has(b.dataset.medida as Medida)));
}

// ---------- Tablas (por CD y por día) ----------

interface ColumnaTabla<T> {
  titulo: string; num?: boolean; texto: (f: T) => string; extra?: (f: T) => string; clase?: string;
  /** Fondo de la celda según el valor (formato condicional del Power BI). */
  color?: (f: T) => string | null;
}
/** Tabla simple con encabezado amarillo, fila de total al pie y filas resaltadas (los CD elegidos en el filtro). */
function tablaSimple<T>(nombre: string, columnas: ColumnaTabla<T>[], filasTabla: readonly T[], total: T | null, elegida?: (f: T) => boolean): HTMLElement {
  const caja = crear('div', 't1-tabla-caja wip-tabla-caja');
  caja.setAttribute('role', 'region');
  caja.tabIndex = 0;
  caja.setAttribute('aria-label', nombre);
  const tabla = crear('table', 't1-tabla wip-tabla');
  tabla.append(crear('caption', 'cc-oculto', nombre));
  const cabeza = tabla.createTHead().insertRow();
  for (const col of columnas) {
    const th = crear('th', col.num ? 'num' : undefined);
    th.scope = 'col';
    if (col.clase) th.append(crear('i', `t1-kpi-serie ${col.clase}`));
    th.append(col.titulo);
    cabeza.append(th);
  }
  const fila = (f: T, i: number, esTotal = false) => {
    const tr = crear('tr', elegida?.(f) ? 'wip-fila-elegida' : undefined);
    tr.style.setProperty('--f', String(i));
    columnas.forEach((col, k) => {
      const celda = crear(k === 0 ? 'th' : 'td', col.num ? 'num' : undefined, col.texto(f));
      if (k === 0) (celda as HTMLTableCellElement).scope = 'row';
      const extra = esTotal ? '' : col.extra?.(f);
      if (extra) celda.append(crear('small', undefined, extra));
      const fondo = esTotal ? null : col.color?.(f);
      if (fondo) { celda.style.background = fondo; celda.classList.add('wip-celda-sem'); }
      tr.append(celda);
    });
    return tr;
  };
  tabla.createTBody().append(...filasTabla.map((f, i) => fila(f, i)));
  if (total) tabla.createTFoot().append(fila(total, filasTabla.length, true));
  caja.append(tabla);
  return caja;
}

type FilaCd = { cd: string } & Usabilidades;
type FilaDia = ResultadoWip['porDia'][number];
const columnasUso = <T extends Usabilidades>(): ColumnaTabla<T>[] => MEDIDAS.map(m => ({
  titulo: m.nombre, num: true, clase: m.clase, texto: (f: T) => pct(f[m.clave]), color: (f: T) => colorUso(f[m.clave], m.clave !== 'armado'),
}));

function pintarTablaCd(r: ResultadoWip, rSinCd: ResultadoWip) {
  const zona = porId('wipTCd');
  porId('wipTCdS').textContent = r.porCd.length ? `${plural(r.porCd.length, 'CD', 'CD')} · todos los CD del rango${filtro.cds.length ? ' (los elegidos, resaltados)' : ''}` : '';
  if (!r.porCd.length) { zona.replaceChildren(crear('p', 't1-grafico-vacio', 'Sin registros con estos filtros.')); return; }
  const elegidos = new Set(filtro.cds);
  zona.replaceChildren(tablaSimple<FilaCd>('Usabilidad por CD',
    [{ titulo: 'CD', texto: f => f.cd }, ...columnasUso<FilaCd>()],
    r.porCd, { cd: 'Total', ...rSinCd.tarjetas }, f => elegidos.has(f.cd)));
}

/** Días por página de la tabla por día; se pasa de página con las flechas (sin barra de desplazamiento). */
const DIAS_POR_PAGINA = 10;
let paginaDia = 0;
let firmaDia = '';

/** Flecha ‹ o › de las tablas con páginas (mismo estilo que las de Seguimiento T1). */
function flecha(direccion: 'anterior' | 'siguiente', deshabilitada: boolean, ir: () => void): HTMLButtonElement {
  const boton = crear('button', 't1-flecha');
  boton.type = 'button';
  boton.dataset.accion = direccion;
  boton.setAttribute('aria-label', direccion === 'anterior' ? 'Días anteriores' : 'Días siguientes');
  boton.disabled = deshabilitada;
  const svg = nodo('svg', { class: 't1-ico', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  svg.append(nodo('path', { d: direccion === 'anterior' ? 'M15 5.5 8.5 12l6.5 6.5' : 'M9 5.5 15.5 12 9 18.5' }));
  boton.append(svg);
  boton.addEventListener('click', ir);
  return boton;
}

function pintarTablaDia(r: ResultadoWip) {
  const zona = porId('wipTDia');
  porId('wipTDiaS').textContent = r.porDia.length ? `${plural(r.porDia.length, 'día', 'días')} · DTs sumados y usabilidad promedio` : '';
  if (!r.porDia.length) { zona.replaceChildren(crear('p', 't1-grafico-vacio', 'Sin registros con estos filtros.')); return; }
  const t = r.tarjetas;
  const total: FilaDia = { fecha: -1, total: t.total, finalizados: t.finalizados, wip: t.wip, armado: t.armado, verificacion: t.verificacion, montacargas: t.montacargas };
  // Si cambian los días (otros filtros), vuelve a la primera página; si son los mismos, se queda donde estaba.
  const firma = r.porDia.map(d => d.fecha).join(',');
  if (firma !== firmaDia) { firmaDia = firma; paginaDia = 0; }
  const paginas = Math.max(1, Math.ceil(r.porDia.length / DIAS_POR_PAGINA));
  paginaDia = Math.min(paginaDia, paginas - 1);
  const desde = paginaDia * DIAS_POR_PAGINA;
  const visibles = r.porDia.slice(desde, desde + DIAS_POR_PAGINA);
  const tabla = tablaSimple<FilaDia>('DTs y usabilidad por día', [
    { titulo: 'Fecha', texto: f => (f.fecha < 0 ? 'Total' : fecha(f.fecha)), extra: f => DIA_CORTO[fechaDeDia(f.fecha).getUTCDay()] },
    { titulo: 'Total DTs', num: true, texto: f => cifra(f.total) },
    { titulo: 'DTs finalizados', num: true, texto: f => cifra(f.finalizados) },
    ...columnasUso<FilaDia>(),
  ], visibles, total);
  if (paginas === 1) { zona.replaceChildren(tabla); return; }
  const ir = (pagina: number, accion: string) => {
    paginaDia = pagina;
    pintarTablaDia(r);
    // La última página puede tener menos días: el gráfico por CD de al lado se vuelve a medir con la tabla nueva.
    dibujar(graficos.cd, false);
    zona.querySelector<HTMLButtonElement>(`[data-accion="${accion}"]:not(:disabled)`)?.focus({ preventScroll: true });
  };
  const pie = crear('div', 't1-paginas wip-dia-paginas');
  const botones = crear('div', 't1-paginas-botones');
  botones.append(
    flecha('anterior', paginaDia === 0, () => ir(paginaDia - 1, 'anterior')),
    flecha('siguiente', paginaDia >= paginas - 1, () => ir(paginaDia + 1, 'siguiente')),
  );
  const info = crear('span', 't1-paginas-info', `Días ${cifra(desde + 1)}–${cifra(desde + visibles.length)} de ${cifra(r.porDia.length)} · página ${paginaDia + 1} de ${paginas}`);
  info.setAttribute('aria-live', 'polite');
  pie.append(info, botones);
  zona.replaceChildren(tabla, pie);
}

// ---------- Mapa de calor (CD × día) ----------

const mapaCaja = porId('wipMapa');
const medidaCaja = porId('wipMapaMedida');
let mapaActual: ResultadoWip['mapa'] | null = null;
let mapaClave = '';
for (const m of MEDIDAS) {
  const b = crear('button', 't1-chip', m.nombre);
  b.type = 'button';
  b.dataset.medida = m.clave;
  b.setAttribute('aria-pressed', String(m.clave === medidaMapa));
  b.addEventListener('click', () => {
    medidaMapa = m.clave;
    for (const otro of medidaCaja.querySelectorAll<HTMLButtonElement>('.t1-chip')) otro.setAttribute('aria-pressed', String(otro.dataset.medida === medidaMapa));
    anuncio.textContent = `El mapa muestra la usabilidad de ${m.nombre.toLowerCase()}.`;
    dibujarMapa();
  });
  medidaCaja.append(b);
}

/** Matriz CD × día: los días que no caben se ven deslizando DENTRO de la tarjeta (la columna de CD queda fija). */
function dibujarMapa() {
  const m = mapaActual;
  const medida = MEDIDAS.find(x => x.clave === medidaMapa)!;
  const valores = m ? m.valores.map(fila => fila.map(u => u?.[medidaMapa] ?? null)) : [];
  const todos = valores.flat().filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!m || !todos.length) { mapaCaja.replaceChildren(crear('p', 't1-grafico-vacio', 'Sin registros con estos filtros.')); return; }
  const { cds, fechas } = m;
  const anterior = mapaCaja.querySelector<HTMLElement>('.wip-mapa-scroll');
  const desplazado = anterior?.scrollLeft ?? 0;
  const ANCHO_CD = Math.round(Math.max(104, Math.max(...cds.map(cd => anchoTexto(cd, 13))) + 26));

  // Colores del Power BI: verde desde la meta (99 %), rojo por debajo; en verificación y montacargas, 0 % sin color.
  const ceroSinColor = medidaMapa !== 'armado';

  const tabla = crear('table', 't1-mapa wip-mapa');
  tabla.style.setProperty('--t1-ancho-cd', `${ANCHO_CD}px`);
  tabla.style.setProperty('--wip-dias', String(fechas.length));
  tabla.append(crear('caption', 'cc-oculto', `Usabilidad de ${medida.nombre.toLowerCase()} en porcentaje por CD (filas) y día (columnas)`));
  const colgrupo = crear('colgroup');
  colgrupo.append(crear('col', 't1-mapa-col-cd'), ...fechas.map(() => crear('col')));
  tabla.append(colgrupo);
  const cabeza = tabla.createTHead();
  // Fila de meses (agrupa las columnas del mismo mes).
  const filaMes = cabeza.insertRow();
  filaMes.className = 't1-mapa-meses';
  const esquina = crear('th', 't1-mapa-esquina wip-mapa-fija', 'CD');
  esquina.rowSpan = 2;
  esquina.scope = 'col';
  filaMes.append(esquina);
  let mesActual = '';
  for (const f of fechas) {
    const mes = mesDeDia(f);
    if (mes === mesActual) { (filaMes.lastElementChild as HTMLTableCellElement).colSpan += 1; continue; }
    mesActual = mes;
    const th = crear('th', 't1-mapa-mes', nombreMes(mes));
    th.scope = 'colgroup';
    filaMes.append(th);
  }
  const filaDia = cabeza.insertRow();
  for (const f of fechas) {
    const dia = fechaDeDia(f).getUTCDay();
    const th = crear('th', `t1-mapa-dia${dia === 0 ? ' t1-domingo' : ''}`);
    th.scope = 'col';
    th.setAttribute('aria-label', fechaLarga(f));
    th.append(crear('small', undefined, DIA_CORTO[dia].charAt(0).toUpperCase()), crear('b', undefined, String(fechaDeDia(f).getUTCDate())));
    filaDia.append(th);
  }
  const cuerpo = tabla.createTBody();
  cds.forEach((cd, fila) => {
    const tr = cuerpo.insertRow();
    tr.style.setProperty('--f', String(fila));
    const th = crear('th', 't1-mapa-cd wip-mapa-fija', cd);
    th.scope = 'row';
    tr.append(th);
    fechas.forEach((_, j) => {
      const v = valores[fila][j];
      // Sin registro ese día: rayado. Con registro pero esta usabilidad vacía (sus estados en blanco): «—».
      const hay = !!m.valores[fila][j];
      const td = crear('td', v !== null ? 't1-celda' : hay ? 'wip-celda-sin-dato' : 't1-celda-vacia wip-celda-vacia', v === null && hay ? '—' : undefined);
      if (v === null) td.setAttribute('aria-label', hay ? 'sin dato' : 'sin registro');
      else {
        const fondo = colorUso(v, ceroSinColor);
        if (fondo) { td.style.background = fondo; td.style.color = '#111'; }
        td.textContent = pctCelda(v);
      }
      td.dataset.f = String(j);
      td.dataset.c = String(fila);
      tr.append(td);
    });
  });
  tabla.addEventListener('pointermove', evento => {
    const td = (evento.target as Element).closest<HTMLTableCellElement>('td[data-f]');
    if (!td) { ocultarTip(); return; }
    const fila = Number(td.dataset.c);
    const col = Number(td.dataset.f);
    const u = m.valores[fila][col];
    mostrarTip(`${cds[fila]} · ${fechaLarga(fechas[col])}`, u
      ? [...MEDIDAS.map(x => ({ nombre: x.nombre, valor: pct(u[x.clave]), clase: x.clase, fuerte: x.clave === medidaMapa })), { nombre: 'Usabilidad WIP', valor: pct(u.wip) }]
      : [{ nombre: 'Sin registro ese día', valor: '—' }], evento.clientX, evento.clientY);
  });
  tabla.addEventListener('pointerleave', ocultarTip);

  const desliza = crear('div', 'wip-mapa-scroll');
  desliza.setAttribute('role', 'region');
  desliza.tabIndex = 0;
  desliza.setAttribute('aria-label', `Mapa de usabilidad de ${medida.nombre.toLowerCase()} por CD y día; usa las flechas para deslizar`);
  desliza.addEventListener('scroll', ocultarTip, { passive: true });
  desliza.append(tabla);

  const pie = crear('div', 't1-mapa-pie');
  const leyenda = crear('ul', 't1-leyenda wip-mapa-leyenda');
  leyenda.setAttribute('aria-label', 'Convenciones de colores');
  for (const [nivel, texto] of [['ok', `${pctEntero(META_USABILIDAD)} o más`], ['bajo', `Menos de ${pctEntero(META_USABILIDAD)}`]] as const) {
    const li = crear('li');
    const muestraNivel = crear('i', 't1-muestra');
    muestraNivel.style.background = COLOR_USO[nivel];
    li.append(muestraNivel, texto);
    leyenda.append(li);
  }
  pie.append(leyenda, crear('span', 'wip-mapa-ayuda', `Usabilidad de ${medida.nombre.toLowerCase()} en % · rayado: sin registro ese día`), crear('span', 'wip-mapa-ayuda wip-mapa-desliza', 'Desliza para ver todos los días'));
  mapaCaja.replaceChildren(desliza, pie);
  // Mismos días: se conserva lo desplazado; días nuevos: se muestran los más recientes.
  const clave = `${fechas[0]}|${fechas[fechas.length - 1]}|${fechas.length}`;
  desliza.scrollLeft = clave === mapaClave ? desplazado : desliza.scrollWidth;
  mapaClave = clave;
  pie.lastElementChild!.toggleAttribute('hidden', desliza.scrollWidth <= desliza.clientWidth + 1);
}

// ---------- Filtros ----------

/** Lista desplegable con casillas para el CD (como el segmentador de selección múltiple). */
const multi = (() => {
  const raiz = porId('wipMultiCds');
  const etiqueta = porId('wipCdsEt');
  const boton = crear('button', 't1-multi-boton');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');
  boton.setAttribute('aria-controls', 'wipMultiCdsPanel');
  const valor = crear('span', 't1-multi-valor', 'Todos');
  valor.id = 'wipMultiCdsValor';
  boton.setAttribute('aria-labelledby', `${etiqueta.id} ${valor.id}`);
  boton.append(valor, icono('m6 9 6 6 6-6'));
  const panel = crear('div', 't1-multi-panel');
  panel.id = 'wipMultiCdsPanel';
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-labelledby', etiqueta.id);
  const todos = crear('button', 't1-multi-todos', 'Todos (quitar el filtro de CD)');
  todos.type = 'button';
  const lista = crear('div', 't1-multi-lista');
  panel.append(todos, lista);
  raiz.append(boton, panel);
  return { raiz, boton, valor, panel, lista, todos };
})();
function abrirMulti(abrir: boolean) {
  multi.panel.hidden = !abrir;
  multi.boton.setAttribute('aria-expanded', String(abrir));
  if (abrir) multi.panel.querySelector<HTMLElement>('input, button')?.focus();
}
multi.boton.addEventListener('click', () => abrirMulti(multi.panel.hidden !== false));
multi.todos.addEventListener('click', () => { filtro.cds = []; anuncio.textContent = 'Se quitó el filtro de CD.'; pintarFiltros(); recalcular(); });
multi.panel.addEventListener('keydown', evento => { if (evento.key === 'Escape') { abrirMulti(false); multi.boton.focus(); } });
multi.lista.addEventListener('change', evento => {
  const casilla = evento.target as HTMLInputElement;
  const i = filtro.cds.indexOf(casilla.value);
  if (casilla.checked && i < 0) filtro.cds.push(casilla.value);
  if (!casilla.checked && i >= 0) filtro.cds.splice(i, 1);
  filtro.cds.sort(porTexto);
  pintarFiltros();
  recalcular();
});
document.addEventListener('pointerdown', evento => { if (!multi.panel.hidden && !multi.raiz.contains(evento.target as Node)) abrirMulti(false); });

function llenarMulti() {
  if (!opciones) return;
  const elegidos = new Set(filtro.cds);
  multi.lista.classList.toggle('t1-multi-lista-2', opciones.cds.length > 8);
  multi.lista.replaceChildren(...opciones.cds.map(cd => {
    const etiqueta = crear('label', 't1-casilla');
    const casilla = crear('input');
    casilla.type = 'checkbox';
    casilla.value = cd;
    casilla.checked = elegidos.has(cd);
    etiqueta.append(casilla, crear('span', undefined, cd));
    return etiqueta;
  }));
}

/** Pone o quita un CD del filtro (también desde un clic en una columna, como el cruce de filtros del Power BI). */
function alternarCd(cd: string) {
  const i = filtro.cds.indexOf(cd);
  if (i >= 0) filtro.cds.splice(i, 1); else filtro.cds.push(cd);
  filtro.cds.sort(porTexto);
  anuncio.textContent = i >= 0 ? `Se quitó el filtro CD ${cd}.` : `Filtro aplicado: CD ${cd}.`;
  pintarFiltros();
  recalcular();
}

/** Por defecto: el mes de la última fecha, del día 1 a esa fecha. */
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
  llenarMulti();
  multi.valor.textContent = !filtro.cds.length ? 'Todos' : filtro.cds.length === 1 ? filtro.cds[0] : `${filtro.cds.length} elegidos`;
  multi.boton.classList.toggle('t1-con-valor', filtro.cds.length > 0);
  pintarActivos();
}

/** Lista de filtros aplicados, cada uno con su botón para quitarlo. */
function pintarActivos() {
  const lista = porId('wipActivos');
  lista.hidden = !filtro.cds.length;
  lista.replaceChildren(...filtro.cds.map(cd => {
    const li = crear('li');
    const b = crear('button', 't1-activo');
    b.type = 'button';
    b.setAttribute('aria-label', `Quitar filtro CD ${cd}`);
    b.append(crear('span', undefined, `CD: ${cd}`), icono('M7 7l10 10M17 7 7 17'));
    b.addEventListener('click', () => {
      // El foco pasa al siguiente filtro (o al botón de limpiar) para no perderse.
      const siguiente = li.nextElementSibling ?? li.previousElementSibling;
      alternarCd(cd);
      const destino = siguiente ? [...lista.querySelectorAll<HTMLButtonElement>('.t1-activo')].find(x => x.textContent === siguiente.textContent) : null;
      (destino ?? porId<HTMLButtonElement>('wipLimpiar')).focus();
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
porId('wipLimpiar').addEventListener('click', () => {
  filtro.cds = [];
  rangoInicial();
  rangoPorDefecto = true;
  for (const m of MEDIDAS) tendencias.add(m.clave);
  pintarTendencias();
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
  const paso = (ahora: number) => {
    const t = Math.max(0, Math.min(1, (ahora - inicio) / 800)); // el primer cuadro puede llegar antes de "inicio"
    el.textContent = formato(t < 1 ? previo + (valor - previo) * (1 - (1 - t) ** 3) : valor);
    if (t < 1) el.dataset.cuadro = String(requestAnimationFrame(paso));
  };
  el.dataset.cuadro = String(requestAnimationFrame(paso));
}

/** Cifra del indicador: cuenta hasta el valor, con el color de la meta y el valor exacto al pasar el puntero. */
function indicador(id: string, valor: number | null) {
  const el = porId(id);
  contar(el, valor, pctEntero);
  const tarjeta = el.closest('.wip-ind');
  // Como en el Power BI: verde de 99 % a menos de 200 %; rojo de 0 % a menos de 99 %; sin dato, sin color.
  tarjeta?.classList.toggle('wip-ind-ok', valor !== null && valor >= META_USABILIDAD && valor < 2);
  tarjeta?.classList.toggle('wip-ind-bajo', valor !== null && valor >= 0 && valor < META_USABILIDAD);
  el.title = valor === null ? 'Sin datos' : `${pct(valor)} · meta ${pctEntero(META_USABILIDAD)}`;
}

function pintarTarjetas(r: ResultadoWip) {
  const t = r.tarjetas;
  indicador('wipKpiWip', t.wip);
  indicador('wipKpiArmado', t.armado);
  indicador('wipKpiVerif', t.verificacion);
  indicador('wipKpiMonta', t.montacargas);
  porId('wipKpiWipNota').textContent = t.filas ? `Promedio de las tres · ${plural(t.filas, 'registro CD-día', 'registros CD-día')}` : 'Sin registros con estos filtros';
}

function pintarResumen(r: ResultadoWip) {
  const t = r.tarjetas;
  const partes = [filtro.desde === filtro.hasta ? fechaLarga(filtro.desde) : `Del ${fecha(filtro.desde)} al ${fecha(filtro.hasta)}`];
  if (t.filas) {
    partes.push(plural(t.filas, 'registro CD-día', 'registros CD-día'), `${cifra(t.finalizados)} de ${plural(t.total, 'DT finalizado', 'DTs finalizados')}`);
    const cds = new Set(r.mapa.cds).size;
    if (cds) partes.push(plural(cds, 'CD', 'CD'));
  } else partes.push('sin registros con estos filtros');
  resumenTexto.dataset.tipo = '';
  resumenTexto.textContent = partes.join(' · ');
}

function pintarDia(r: ResultadoWip, animar = true) {
  const g = graficos.dia;
  const activas = MEDIDAS.filter(m => tendencias.has(m.clave));
  g.series = activas.map(m => SERIES_USO[m.clave]);
  g.vacio = activas.length ? 'Sin registros con estos filtros.' : 'Activa al menos una tendencia para ver el gráfico.';
  const rango = filtro.desde === filtro.hasta ? fecha(filtro.desde) : `del ${fecha(filtro.desde)} al ${fecha(filtro.hasta)}`;
  ponerCategorias(g, activas.length ? r.porDia.map(d => ({
    clave: String(d.fecha), etiqueta: diaCorto(d.fecha), titulo: fechaLarga(d.fecha), x: d.fecha,
    valores: activas.map(m => d[m.clave]), notas: [{ nombre: 'Usabilidad WIP', valor: pct(d.wip), fuerte: true }],
  })) : [], `${plural(r.porDia.length, 'día', 'días')} · ${rango} · promedio de los CD`, animar);
}

const porValor = <T>(valor: (x: T) => number | null) => (a: T, b: T) => (valor(b) ?? -1) - (valor(a) ?? -1);

function pintarGraficos(r: ResultadoWip) {
  pintarDia(r);
  ponerCategorias(graficos.dts, r.porDia.map(d => ({
    clave: String(d.fecha), etiqueta: diaCorto(d.fecha), titulo: fechaLarga(d.fecha), x: d.fecha, valores: [d.finalizados, d.total],
    notas: [{ nombre: 'Finalizados del total', valor: pct(d.total ? d.finalizados / d.total : null), fuerte: true }],
  })), r.porDia.length ? `${cifra(r.tarjetas.finalizados)} de ${plural(r.tarjetas.total, 'DT finalizado', 'DTs finalizados')} · suma de los CD` : '');

  // Por CD: todos los CD del rango (no le afecta el filtro de CD); los elegidos, resaltados.
  const g = graficos.cd;
  g.seleccion = new Set(filtro.cds);
  ponerCategorias(g, [...r.porCd].sort(porValor(c => c.wip)).map(c => ({
    clave: c.cd, etiqueta: c.cd, titulo: c.cd, valores: [c.wip],
    notas: MEDIDAS.map(m => ({ nombre: m.nombre, valor: pct(c[m.clave]), clase: m.clase })),
  })), `${plural(r.porCd.length, 'CD', 'CD')} · de mayor a menor${filtro.cds.length ? ' · los elegidos, resaltados' : ''}`);

  ponerCategorias(graficos.gerencia, [...r.porGerencia].sort(porValor(x => x.wip)).map(x => ({ clave: x.gerencia, etiqueta: x.gerencia, titulo: `Gerencia ${x.gerencia}`, valores: [x.wip] })),
    `${plural(r.porGerencia.length, 'gerencia', 'gerencias')} · de mayor a menor`);
  ponerCategorias(graficos.ol, [...r.porOl].sort(porValor(x => x.wip)).map(x => ({ clave: x.ol, etiqueta: x.ol, titulo: `OL ${x.ol}`, valores: [x.wip] })));
  ponerCategorias(graficos.semana, r.porSemana.map(s => {
    const dias = diasDeSemana.get(s.semana);
    return { clave: String(s.semana), etiqueta: `Semana ${s.semana}`, titulo: `Semana ${s.semana}${dias ? ` · ${diaCorto(dias[0])} a ${diaCorto(dias[1])}` : ''}`, valores: [s.wip], x: s.semana };
  }), `${plural(r.porSemana.length, 'semana', 'semanas')} · todas las fechas cargadas (no le afectan el rango ni el mes)${filtro.cds.length ? ' · CD elegidos' : ''}`);
}

function pintarMapa(r: ResultadoWip) {
  mapaActual = r.mapa;
  porId('wipMapaS').textContent = r.mapa.cds.length ? `${plural(r.mapa.cds.length, 'CD', 'CD')} × ${plural(r.mapa.fechas.length, 'día', 'días')} · promedio de cada CD en el día` : '';
  dibujarMapa();
}

function pintar() {
  if (!filas || !opciones) return;
  const r = calcular({ desde: filtro.desde, hasta: filtro.hasta, cds: filtro.cds });
  // La tabla por CD (como en el Power BI) no depende del filtro de CD: su total sale del rango sin ese filtro.
  const rSinCd = filtro.cds.length ? calcular({ desde: filtro.desde, hasta: filtro.hasta, cds: [] }) : r;
  resultado = r;
  pintarResumen(r);
  pintarTarjetas(r);
  // Tablas antes que los gráficos: el de CD mide el alto de su fila, que lo pone la tabla por día.
  pintarTablaCd(r, rSinCd);
  pintarTablaDia(r);
  pintarGraficos(r);
  pintarMapa(r);
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

/** Nota discreta: CD del archivo que no están en la tabla de gerencias. */
function pintarAvisoCd() {
  const sinCd = opciones?.sinCd ?? [];
  porId('wipAvisoCd').hidden = !sinCd.length;
  porId('wipAvisoCdTexto').textContent = sinCd.length
    ? `${sinCd.length === 1 ? '1 CD del archivo no está en la tabla de gerencias y no se muestra' : `${cifra(sinCd.length)} CD del archivo no están en la tabla de gerencias y no se muestran`}: ${[...sinCd].sort(porTexto).join(', ')}.`
    : '';
}

// ---------- Carga de datos ----------

/** Junto al botón "Subir Excel": lo guardado (todos los archivos juntos) y el último archivo (nombre, quién y cuándo). */
function pintarCarga() {
  const c = carga;
  porId('wipHeroDatos').textContent = c
    ? `Datos guardados: ${plural(c.filas, 'fila', 'filas')} del ${fecha(diaDeIso(c.desde))} al ${fecha(diaDeIso(c.hasta))}${c.cargas ? ` (${plural(c.cargas, 'archivo', 'archivos')})` : ''} · último: ${c.archivo}, subido por ${c.usuario_nombre || 'sin nombre'} el ${formatoMomento.format(new Date(c.creado_en))}`
    : 'Sin datos cargados';
}

/** Copia de los datos en el navegador: se vuelven a descargar solo cuando alguien sube un archivo nuevo. */
const ALMACEN_WIP = 'wip-datos';
async function pedirDatos(): Promise<ColumnasWip> {
  const ruta = '/api/wip/datos/wip';
  const url = `${ruta}?v=${encodeURIComponent(carga?.creado_en ?? '')}`;
  const almacen = 'caches' in window ? await caches.open(ALMACEN_WIP).catch(() => null) : null;
  const guardada = await almacen?.match(url).catch(() => undefined);
  if (guardada) {
    try { return await guardada.json() as ColumnasWip; } catch { /* Copia dañada: se descarga de nuevo. */ }
  }
  const respuesta = await fetch(url);
  if (respuesta.status === 401) { location.replace('/'); throw new Error('La sesión terminó.'); }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    throw new Error(cuerpo.error || 'No se pudieron consultar los datos de WIP.');
  }
  if (almacen) {
    try {
      for (const vieja of await almacen.keys()) if (new URL(vieja.url).pathname === ruta) await almacen.delete(vieja);
      await almacen.put(url, respuesta.clone());
    } catch { /* Sin espacio para la copia: la página funciona igual. */ }
  }
  return respuesta.json() as Promise<ColumnasWip>;
}

function mostrarVacio(sinDatos: boolean) {
  porId('wipVacio').hidden = !sinDatos;
  tablero.hidden = sinDatos;
  document.querySelector<HTMLElement>('.wip-indicadores')!.hidden = sinDatos;
  // Sin datos no hay nada que filtrar: quedan solo el estado y el progreso de la carga.
  document.querySelector<HTMLElement>('#wipFiltros .t1-filtros-fila')!.hidden = sinDatos;
  if (sinDatos) porId('wipAvisoCd').hidden = true;
}

/** Tras una carga nueva, el rango elegido se ajusta a las fechas que existen. */
function ponerDentro() {
  if (!opciones || opciones.desde === null || opciones.hasta === null) return;
  filtro.desde = Math.min(opciones.hasta, Math.max(opciones.desde, filtro.desde));
  filtro.hasta = Math.min(opciones.hasta, Math.max(filtro.desde, filtro.hasta));
}

function cargar(): Promise<void> {
  cargando ??= (async () => {
    document.body.classList.add('t1-cargando');
    try {
      const respuesta = await fetch('/api/wip/estado');
      if (respuesta.status === 401) { location.replace('/'); return; }
      const estado = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(estado.error || 'No se pudo consultar Seguimiento WIP.');
      carga = estado.wip ?? null;
      pintarCarga();
      if (!carga) {
        filas = null;
        mostrarVacio(true);
        resumenTexto.dataset.tipo = '';
        resumenTexto.textContent = 'Aún no hay datos: sube Data WIP.xlsx.';
        return;
      }
      resumenTexto.textContent = `Cargando ${plural(carga.filas, 'registro', 'registros')} de WIP…`;
      filas = filasWip(await pedirDatos());
      opciones = opcionesWip(filas);
      memoria.clear();
      diasDeSemana = new Map();
      for (const f of filas) {
        const r = diasDeSemana.get(f.semana);
        if (!r) diasDeSemana.set(f.semana, [f.fecha, f.fecha]);
        else { if (f.fecha < r[0]) r[0] = f.fecha; if (f.fecha > r[1]) r[1] = f.fecha; }
      }
      // Los CD que ya no existen en los datos nuevos se quitan del filtro.
      filtro.cds = filtro.cds.filter(v => opciones!.cds.includes(v));
      if (rangoPorDefecto || !filtro.desde) rangoInicial();
      else ponerDentro();
      llenarMeses();
      mostrarVacio(false);
      pintarAvisoCd();
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

// Subir Data WIP.xlsx: se lee en segundo plano (cargas-worker), se sube comprimido y se recarga la página.
const entradaArchivo = porId<HTMLInputElement>('wipArchivo');
const progreso = porId('wipProgreso');
const progresoTexto = porId('wipProgresoTexto');
const botonesSubir = ['wipSubir', 'wipVacioSubir'].map(id => porId<HTMLButtonElement>(id));
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
    trabajador.onerror = () => { trabajador.terminate(); resolver({ error: 'No se pudo leer el archivo. Verifica que sea Data WIP.xlsx y vuelve a intentar.' }); };
    trabajador.postMessage({ file, tipo: 'wip' });
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
      avance(`Subiendo ${archivo.name} · ${plural(lectura.filas ?? 0, 'fila', 'filas')}…`);
      const respuesta = await fetch('/api/wip/cargar/wip', {
        method: 'POST', body: lectura.gzip,
        headers: { 'Content-Type': 'application/octet-stream', 'x-archivo': encodeURIComponent(archivo.name) },
      });
      if (respuesta.status === 401) { location.replace('/'); return; }
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) problema = cuerpo.error || 'no se pudo guardar.';
      else {
        const omitidas = lectura.omitidas?.length ?? 0;
        listo = `${archivo.name}: ${plural(lectura.filas ?? 0, 'fila', 'filas')}${lectura.desde != null && lectura.hasta != null ? `, del ${fecha(lectura.desde)} al ${fecha(lectura.hasta)}` : ''}`
          + (omitidas ? ` · ${omitidas >= 50 ? '50 o más filas' : plural(omitidas, 'fila', 'filas')} sin fecha o total válido se ${omitidas === 1 ? 'omitió' : 'omitieron'} (fila ${lectura.omitidas![0].fila}: ${lectura.omitidas![0].motivo.toLowerCase()})` : '');
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
  else if (listo) avance(`Guardado en sus fechas; lo de otras fechas se conserva. ${listo}.`, 'ok');
}
for (const b of botonesSubir) b.addEventListener('click', () => entradaArchivo.click());
entradaArchivo.addEventListener('change', () => void subir(entradaArchivo.files?.[0]));

/** Si alguien sube un archivo mientras la página está abierta, se cargan los datos nuevos sin recargar. */
async function revisarCargasNuevas() {
  if (cargando || subiendo || document.hidden) return;
  try {
    const respuesta = await fetch('/api/wip/estado');
    if (!respuesta.ok) return;
    const estado = await respuesta.json() as { wip?: Carga | null };
    if ((estado.wip?.creado_en ?? null) !== (carga?.creado_en ?? null) && !cargando) await cargar();
  } catch { /* Sin conexión: se intenta en la próxima revisión. */ }
}
setInterval(() => void revisarCargasNuevas(), 120_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void revisarCargasNuevas(); });

void cargar();

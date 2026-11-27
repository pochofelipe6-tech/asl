// Módulo Inventario activos: réplica de la página "Inventario activos" del Power BI.
// Lee los conteos del formulario "Control de inventarios" y suma lo que cae en los filtros (fechas, CD y mes),
// con un solo conteo por CD y por día: el último de ese día (ver src/shared/activos.ts).
// Muestra 4 totales, 3 donas, 4 gráficos de columnas por CD, la tabla por CD y 4 gráficos por día.
// Gráficos en SVG propio; cada uno trae "Ver tabla" con las mismas cifras. Tema, usuario y salida: modulos.ts.
import { porId } from './dom';
import { CDS_REGIONAL_NORTE } from '../shared/formularios';
import {
  CAJAS, ESTIBAS, HL, ISOTANQUES, diaColombia, diasEntre, finDeMes, mesesConConteos, primerDiaConConteos,
  resumirActivos, sumarDias, totalCajas, totalEstibas, totalIsotanques, ultimoDiaConConteos,
} from '../shared/activos';
import type { Cantidades, Conteo, Referencia, ResumenActivos } from '../shared/activos';

const SVG = 'http://www.w3.org/2000/svg';
const SIN_CONEXION = 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Formatos ----------

const cifra = (n: number, decimales = 0) => n.toLocaleString('es-CO', { maximumFractionDigits: decimales });
const cifraHl = (n: number) => cifra(n, 2);
/** Mediodía UTC del día: así el formato no cambia de día por la zona horaria del equipo. */
const fechaDe = (dia: string) => new Date(`${dia}T12:00:00Z`);
const formatoFecha = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const formatoMesCorto = new Intl.DateTimeFormat('es-CO', { month: 'short', timeZone: 'UTC' });
/** "26 nov", para el eje de los gráficos por día. */
const diaCorto = (dia: string) => `${Number(dia.slice(8, 10))} ${formatoMesCorto.format(fechaDe(dia)).replace('.', '')}`;
const formatoSemana = new Intl.DateTimeFormat('es-CO', { weekday: 'long', timeZone: 'UTC' });
const formatoMes = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n: number, uno: string, varios: string) => `${cifra(n)} ${n === 1 ? uno : varios}`;
const hoy = () => diaColombia(Date.now());
const fecha = (dia: string) => formatoFecha.format(fechaDe(dia));
/** "Hoy", "Ayer" o el día de la semana. */
function nombreDia(dia: string): string {
  const h = hoy();
  return dia === h ? 'Hoy' : dia === sumarDias(h, -1) ? 'Ayer' : mayuscula(formatoSemana.format(fechaDe(dia)));
}
/** "Hoy, 26/11/2026" o "Del 20/11/2026 al 26/11/2026". */
const textoPeriodo = (desde: string, hasta: string) => (desde === hasta ? `${nombreDia(desde)}, ${fecha(desde)}` : `Del ${fecha(desde)} al ${fecha(hasta)}`);
/** "hoy", "ayer", "el 24/11/2026" o "entre el 20/11/2026 y el 26/11/2026", para frases. */
function enElPeriodo(desde: string, hasta: string): string {
  if (desde !== hasta) return `entre el ${fecha(desde)} y el ${fecha(hasta)}`;
  const n = nombreDia(desde);
  return n === 'Hoy' ? 'hoy' : n === 'Ayer' ? 'ayer' : `el ${fecha(desde)}`;
}

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

// ---------- Estado ----------

type Atajo = 'ultimo' | 'semana' | 'mes' | 'todo' | '';
let registros: Conteo[] | null = null;
let truncado = false;
let cargando: Promise<void> | null = null;
const filtro = { desde: '', hasta: '', cd: '' };
/** El atajo elegido. "ultimo" se recalcula con el CD: muestra el último día en que ese CD (o cualquiera) contó. */
let atajo: Atajo = 'ultimo';

const campoDesde = porId<HTMLInputElement>('aaDesde');
const campoHasta = porId<HTMLInputElement>('aaHasta');
const campoCd = porId<HTMLSelectElement>('aaCd');
const campoMes = porId<HTMLSelectElement>('aaMes');
const resumenTexto = porId('aaResumen');
const anuncio = porId('aaAnuncio');
const tablero = porId('aaTablero');

// ---------- Totales (tarjetas de arriba) ----------

/** Las cifras cuentan desde su valor anterior hasta el nuevo (desde 0 al abrir). */
function contar(el: HTMLElement, valor: number, formato: (n: number) => string = n => cifra(n)) {
  const desde = Number(el.dataset.valor ?? 0);
  el.dataset.valor = String(valor);
  cancelAnimationFrame(Number(el.dataset.cuadro ?? 0));
  if (sinMovimiento.matches || desde === valor) { el.textContent = formato(valor); return; }
  const inicio = performance.now();
  const paso = (ahora: number) => {
    const t = Math.max(0, Math.min(1, (ahora - inicio) / 900)); // el primer cuadro puede llegar antes de "inicio"
    const actual = desde + (valor - desde) * (1 - (1 - t) ** 3);
    el.textContent = formato(t < 1 ? Math.round(actual) : valor);
    if (t < 1) el.dataset.cuadro = String(requestAnimationFrame(paso));
  };
  el.dataset.cuadro = String(requestAnimationFrame(paso));
}

function pintarTotales(r: ResumenActivos) {
  contar(porId('aaKpiEstibas'), totalEstibas(r.total));
  contar(porId('aaKpiCajas'), totalCajas(r.total));
  contar(porId('aaKpiIsotanques'), totalIsotanques(r.total));
  contar(porId('aaKpiHl'), r.total.hl_pendientes_verter, cifraHl);
  const notaIso = `Llenos + vacíos · Necesidad: ${cifra(r.total.necesidad_isotanques)}`;
  porId('aaKpiIsotanquesNota').textContent = notaIso;
  porId('aaKpiIsotanquesNota').closest('article')!.title = notaIso;
}

// ---------- Ventanita de detalle (al pasar el puntero o con las flechas del teclado) ----------

const tip = porId('aaTip');
/** Clase de color de una serie (la paleta del Power BI "Seguimiento ATCT", en activos.css). */
const colorDe = (clave: string) => `aa-k-${clave.replace(/_/g, '-')}`;
interface FilaTip { nombre: string; valor: string; color?: string; fuerte?: boolean }

function mostrarTip(titulo: string, filas: readonly FilaTip[], x: number, y: number) {
  const lista = crear('dl', 'aa-tip-filas');
  for (const f of filas) {
    const dt = crear('dt', f.fuerte ? 'aa-tip-total' : undefined);
    if (f.color) dt.append(crear('i', `aa-tip-clave ${f.color}`));
    dt.append(f.nombre);
    lista.append(dt, crear('dd', f.fuerte ? 'aa-tip-total' : undefined, f.valor));
  }
  tip.replaceChildren(crear('strong', 'aa-tip-titulo', titulo), lista);
  tip.hidden = false;
  const caja = tip.getBoundingClientRect();
  const izquierda = Math.min(Math.max(8, x - caja.width / 2), innerWidth - caja.width - 8);
  const arriba = y - caja.height - 14 < 8 ? y + 18 : y - caja.height - 14;
  tip.style.left = `${izquierda}px`;
  tip.style.top = `${arriba}px`;
}
const ocultarTip = () => { tip.hidden = true; };
addEventListener('scroll', ocultarTip, { passive: true });

// ---------- Donas ----------

interface Dona { caja: HTMLElement; refs: readonly Referencia[]; unidad: string; nombre: string }
const donas = {
  estibas: { caja: porId('aaDonaEstibas'), refs: ESTIBAS, unidad: 'estibas', nombre: 'Estibas por tipo' },
  cajas: { caja: porId('aaDonaCajas'), refs: CAJAS, unidad: 'estibas plásticas', nombre: 'Estibas plásticas por referencia' },
  isotanques: { caja: porId('aaDonaIsotanques'), refs: ISOTANQUES, unidad: 'isotanques', nombre: 'Isotanques' },
} satisfies Record<string, Dona>;

const porcentaje = (parte: number, total: number) => (total ? `${(parte / total * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %` : '0 %');

function pintarDona(d: Dona, c: Cantidades) {
  const valores = d.refs.map(r => c[r.clave]);
  const total = valores.reduce((a, b) => a + b, 0);
  const R = 78, GROSOR = 24, CENTRO = 100;
  const svg = nodo('svg', { viewBox: '0 0 200 200', class: 'aa-dona', role: 'img' });
  svg.setAttribute('aria-label', `${d.nombre}: ${d.refs.map((r, i) => `${r.nombre} ${cifra(valores[i])}`).join(', ')}. Total ${cifra(total)}.`);
  svg.append(nodo('circle', { cx: CENTRO, cy: CENTRO, r: R, class: 'aa-dona-pista', 'stroke-width': GROSOR }));
  const conValor = valores.filter(v => v > 0).length;
  // 2 px de separación entre partes (en unidades de pathLength = 100).
  const hueco = conValor > 1 ? (2.5 / (2 * Math.PI * R)) * 100 : 0;
  const segmentos: SVGCircleElement[] = [];
  let inicio = 0;
  d.refs.forEach((r, i) => {
    const v = valores[i];
    if (!v || !total) { segmentos.push(null as unknown as SVGCircleElement); return; }
    const largo = (v / total) * 100;
    const trazo = Math.max(0.25, largo - hueco);
    const seg = nodo('circle', {
      cx: CENTRO, cy: CENTRO, r: R, pathLength: 100, 'stroke-width': GROSOR, class: `aa-dona-seg ${colorDe(r.clave)}`,
      'stroke-dasharray': `${trazo} ${100 - trazo}`, 'stroke-dashoffset': -(inicio + hueco / 2), transform: `rotate(-90 ${CENTRO} ${CENTRO})`,
      style: `--i:${i}`,
    });
    const mostrar = (evento: PointerEvent) => {
      svg.classList.add('aa-enfoque');
      seg.classList.add('activo');
      mostrarTip(r.nombre, [{ nombre: 'Cantidad', valor: `${cifra(v)} ${d.unidad}`, color: colorDe(r.clave), fuerte: true }, { nombre: 'Del total', valor: porcentaje(v, total) }], evento.clientX, evento.clientY);
    };
    seg.addEventListener('pointermove', mostrar);
    seg.addEventListener('pointerleave', () => { svg.classList.remove('aa-enfoque'); seg.classList.remove('activo'); ocultarTip(); });
    svg.append(seg);
    segmentos.push(seg);
    inicio += largo;
  });
  const centro = crear('div', 'aa-dona-centro');
  centro.append(crear('strong', undefined, cifra(total)), crear('span', undefined, d.unidad));
  const figura = crear('div', 'aa-dona-figura');
  figura.append(svg, centro);

  // Leyenda con cantidad y porcentaje: las cifras se leen sin pasar el puntero.
  const leyenda = crear('ul', 'aa-dona-leyenda');
  leyenda.setAttribute('aria-label', `Detalle de ${d.nombre.toLowerCase()}`);
  d.refs.forEach((r, i) => {
    const li = crear('li', 'aa-dona-item');
    li.style.setProperty('--i', String(i));
    const nombre = crear('span', 'aa-dona-nombre');
    nombre.append(crear('i', `aa-muestra ${colorDe(r.clave)}`), r.nombre);
    const cifras = crear('span', 'aa-dona-cifras');
    cifras.append(crear('b', undefined, cifra(valores[i])), crear('small', undefined, porcentaje(valores[i], total)));
    li.append(nombre, cifras);
    const seg = segmentos[i];
    if (seg) {
      li.addEventListener('pointerenter', () => { svg.classList.add('aa-enfoque'); seg.classList.add('activo'); });
      li.addEventListener('pointerleave', () => { svg.classList.remove('aa-enfoque'); seg.classList.remove('activo'); });
    }
    leyenda.append(li);
  });
  d.caja.replaceChildren(figura, leyenda);
}

// ---------- Gráficos de columnas (por CD y por día) ----------

interface Serie { nombre: string; corto: string; color: string }
interface Columna { etiqueta: string; titulo: string; valores: number[] }
interface Grafico {
  caja: HTMLElement;
  subtitulo: HTMLElement;
  nombre: string;
  tipo: 'cd' | 'dia';
  series: Serie[];
  columnas: Columna[];
  unidad: string;
  formato: (n: number) => string;
  enTabla: boolean;
  ancho: number;
  /** Columna elegida con el teclado. */
  foco: number;
}

const seriesDe = (refs: readonly Referencia[]): Serie[] => refs.map(r => ({ nombre: r.nombre, corto: r.corto, color: colorDe(r.clave) }));
function nuevoGrafico(caja: string, subtitulo: string, nombre: string, tipo: Grafico['tipo'], refs: readonly Referencia[], unidad: string, formato = (n: number) => cifra(n)): Grafico {
  return { caja: porId(caja), subtitulo: porId(subtitulo), nombre, tipo, series: seriesDe(refs), columnas: [], unidad, formato, enTabla: false, ancho: 0, foco: 0 };
}
const graficos: Record<string, Grafico> = {
  cdEstibas: nuevoGrafico('aaGCdEst', 'aaGCdEstS', 'Estibas por CD y tipo', 'cd', ESTIBAS, 'estibas'),
  cdCajas: nuevoGrafico('aaGCdCaj', 'aaGCdCajS', 'Estibas plásticas por CD y referencia', 'cd', CAJAS, 'estibas plásticas'),
  cdIsotanques: nuevoGrafico('aaGCdIso', 'aaGCdIsoS', 'Isotanques por CD', 'cd', ISOTANQUES, 'isotanques'),
  cdHl: nuevoGrafico('aaGCdHl', 'aaGCdHlS', 'HL pendientes por verter por CD', 'cd', [HL], 'HL', cifraHl),
  diaEstibas: nuevoGrafico('aaGDiaEst', 'aaGDiaEstS', 'Estibas por día y tipo', 'dia', ESTIBAS, 'estibas'),
  diaCajas: nuevoGrafico('aaGDiaCaj', 'aaGDiaCajS', 'Estibas plásticas por día y referencia', 'dia', CAJAS, 'estibas plásticas'),
  diaIsotanques: nuevoGrafico('aaGDiaIso', 'aaGDiaIsoS', 'Isotanques por día', 'dia', ISOTANQUES, 'isotanques'),
  diaHl: nuevoGrafico('aaGDiaHl', 'aaGDiaHlS', 'HL pendientes por verter por día', 'dia', [HL], 'HL', cifraHl),
};

/** Marcas "redondas" del eje (0, 250, 500…): unas 5, de a pasos enteros. */
function marcasEje(max: number): number[] {
  const bruto = Math.max(max, 1) / 5;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = Math.max(1, [1, 2, 2.5, 5, 10].map(f => f * potencia).find(p => p >= bruto) ?? 10 * potencia);
  const marcas = [0];
  while (marcas[marcas.length - 1] < max) marcas.push(marcas[marcas.length - 1] + paso);
  return marcas.length > 1 ? marcas : [0, paso];
}
/** Eje completo por debajo de 10.000 (0, 2.500, 5.000) y corto desde ahí (0, 10k, 20k). */
const cifraEje = (n: number, corto: boolean) => !corto || !n ? cifra(n)
  : n >= 1e6 ? `${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 2 })}M` : `${(n / 1e3).toLocaleString('es-CO', { maximumFractionDigits: 1 })}k`;
/** Ancho aproximado de un texto de 11,5 px (Segoe UI, seminegrita). */
const anchoTexto = (texto: string) => texto.length * 6.7;
/** Parte un nombre en dos líneas lo más parejas posible ("Cartagena KA" → "Cartagena" / "KA"). */
function enDosLineas(nombre: string): string[] {
  const palabras = nombre.split(' ');
  if (palabras.length < 2) return [nombre];
  let mejor = [nombre];
  let peor = Infinity;
  for (let i = 1; i < palabras.length; i++) {
    const partes = [palabras.slice(0, i).join(' '), palabras.slice(i).join(' ')];
    const largo = Math.max(...partes.map(p => p.length));
    if (largo < peor) { peor = largo; mejor = partes; }
  }
  return mejor;
}

const totalDe = (c: Columna) => c.valores.reduce((a, b) => a + b, 0);

function filasTip(g: Grafico, c: Columna): FilaTip[] {
  // De arriba hacia abajo, en el mismo orden en que se apilan las partes.
  const filas: FilaTip[] = g.series.map((s, i) => ({ nombre: s.nombre, valor: g.formato(c.valores[i]), color: g.series.length > 1 ? s.color : undefined, fuerte: g.series.length === 1 })).reverse();
  if (g.series.length > 1) filas.push({ nombre: 'Total', valor: `${g.formato(totalDe(c))} ${g.unidad}`, fuerte: true });
  else filas[0].valor = `${filas[0].valor} ${g.unidad}`;
  return filas;
}

function textoColumna(g: Grafico, c: Columna): string {
  const partes = g.series.length > 1 ? g.series.map((s, i) => `${s.nombre} ${g.formato(c.valores[i])}`).join(', ') + `, total ${g.formato(totalDe(c))}` : `${g.formato(c.valores[0])} ${g.unidad}`;
  return `${c.titulo}: ${partes}`;
}

function leyendaDe(g: Grafico): HTMLElement | null {
  if (g.series.length < 2) return null;
  const lista = crear('ul', 'aa-leyenda');
  lista.setAttribute('aria-label', 'Convenciones');
  for (const s of g.series) {
    const li = crear('li');
    li.append(crear('i', `aa-muestra ${s.color}`), s.nombre);
    lista.append(li);
  }
  return lista;
}

/** La tabla con las mismas cifras del gráfico (botón "Ver tabla"). */
function tablaDe(g: Grafico): HTMLElement {
  const caja = crear('div', 'aa-tabla-caja aa-tabla-grafico');
  caja.setAttribute('role', 'region');
  caja.tabIndex = 0;
  caja.setAttribute('aria-label', `Tabla: ${g.nombre}`);
  const tabla = crear('table', 'aa-tabla aa-tabla-mini');
  const cabeza = tabla.createTHead().insertRow();
  const encabezados = [g.tipo === 'cd' ? 'CD' : 'Día', ...g.series.map(s => (g.series.length > 2 ? s.corto : s.nombre)), ...(g.series.length > 1 ? ['Total'] : [])];
  encabezados.forEach((texto, i) => {
    const th = crear('th', i ? 'num' : undefined, texto);
    th.scope = 'col';
    cabeza.append(th);
  });
  const cuerpo = tabla.createTBody();
  for (const c of g.columnas) {
    const fila = cuerpo.insertRow();
    const th = crear('th', undefined, c.titulo);
    th.scope = 'row';
    fila.append(th, ...c.valores.map(v => crear('td', 'num', g.formato(v))));
    if (g.series.length > 1) fila.append(crear('td', 'num aa-total', g.formato(totalDe(c))));
  }
  caja.append(tabla);
  return caja;
}

function dibujar(g: Grafico, animar = true) {
  const ancho = Math.floor(g.caja.clientWidth);
  g.ancho = ancho;
  g.caja.classList.toggle('aa-quieto', !animar);
  // Si la ventanita era de este gráfico, su columna va a desaparecer.
  if (g.caja.contains(document.querySelector('.aa-col.activa'))) ocultarTip();
  if (!g.columnas.length) {
    g.caja.replaceChildren(crear('p', 'aa-grafico-vacio', 'Sin conteos en este periodo.'));
    return;
  }
  if (g.enTabla) { g.caja.replaceChildren(tablaDe(g)); return; }
  if (!ancho) return; // Oculto: se dibuja al mostrarse (ResizeObserver).

  const n = g.columnas.length;
  const totales = g.columnas.map(totalDe);
  const marcas = marcasEje(Math.max(...totales));
  const tope = marcas[marcas.length - 1];
  const corto = tope >= 10_000;
  const etiquetasEje = marcas.map(m => cifraEje(m, corto));
  const IZQUIERDA = Math.round(Math.max(...etiquetasEje.map(anchoTexto)) + 14);
  const DERECHA = 10;
  const ARRIBA = 24;
  const largo = Math.max(60, ancho - IZQUIERDA - DERECHA);
  const hueco = largo / n;
  const grosor = Math.max(3, Math.min(24, hueco * 0.62));
  // Tablero compacto (como el Power BI): columnas más bajas.
  const ALTO = Math.round(Math.min(210, Math.max(150, ancho * 0.2)));

  // Etiquetas del eje horizontal: rectas en una o dos líneas si caben; inclinadas si no (CD), o salteadas (días).
  let inclinar = false;
  let saltar = 1;
  let lineas: string[][] = [];
  if (g.tipo === 'cd') {
    lineas = g.columnas.map(c => enDosLineas(c.etiqueta));
    const masAncha = Math.max(...lineas.flat().map(anchoTexto));
    inclinar = masAncha > hueco - 6;
  } else {
    const masAncha = Math.max(...g.columnas.map(c => anchoTexto(c.etiqueta)));
    saltar = Math.max(1, Math.ceil((masAncha + 10) / hueco));
  }
  const masLarga = Math.max(...g.columnas.map(c => anchoTexto(c.etiqueta)));
  // Texto inclinado 40°: baja sen(40°) ≈ 0,64 de su largo, más el alto de la letra.
  const ABAJO = inclinar ? Math.round(masLarga * 0.6 + 24) : g.tipo === 'cd' && lineas.some(l => l.length > 1) ? 46 : 30;
  const altoTotal = ARRIBA + ALTO + ABAJO;
  const base = ARRIBA + ALTO;
  const yDe = (v: number) => base - (v / tope) * ALTO;

  const svg = nodo('svg', { width: ancho, height: altoTotal, viewBox: `0 0 ${ancho} ${altoTotal}`, class: 'aa-columnas', tabindex: 0, role: 'img' });
  svg.setAttribute('aria-label', `${g.nombre}. ${n === 1 ? 'Una columna' : `${n} columnas`}. Usa las flechas izquierda y derecha para leer cada una. ${g.columnas.slice(0, 20).map(c => textoColumna(g, c)).join('. ')}`);
  // Guías horizontales (finas, sólidas) y valores del eje.
  marcas.forEach((m, i) => {
    const y = yDe(m);
    svg.append(nodo('line', { x1: IZQUIERDA, x2: ancho - DERECHA, y1: y, y2: y, class: m ? 'aa-guia' : 'aa-base' }));
    svg.append(nodo('text', { x: IZQUIERDA - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'aa-eje' }, etiquetasEje[i]));
  });

  // Cifras sobre las columnas: todas si caben; si no, solo la más alta (las demás, en la ventanita y en la tabla).
  const caben = totales.every(t => anchoTexto(g.formato(t)) <= hueco - 4);
  const mayor = totales.indexOf(Math.max(...totales));
  const columnas: SVGGElement[] = [];
  g.columnas.forEach((c, i) => {
    const centro = IZQUIERDA + hueco * (i + 0.5);
    const x = centro - grosor / 2;
    const grupo = nodo('g', { class: 'aa-col', style: `--i:${i}` });
    // Zona sensible: toda la franja de la columna, no solo la barra.
    grupo.append(nodo('rect', { x: IZQUIERDA + hueco * i, y: ARRIBA - 18, width: hueco, height: ALTO + 18, class: 'aa-col-zona' }));
    const barra = nodo('g', { class: 'aa-col-barra' });
    const ultima = c.valores.reduce((u, v, k) => (v > 0 ? k : u), -1);
    let y0 = base;
    c.valores.forEach((v, k) => {
      if (v <= 0) return;
      const alto = (v / tope) * ALTO;
      const arriba = y0 - alto;
      if (k === ultima) {
        // Punta redondeada (4 px) y base cuadrada.
        const r = Math.min(4, grosor / 2, alto);
        barra.append(nodo('path', { class: `aa-parte ${g.series[k].color}`, d: `M${x} ${y0}V${arriba + r}a${r} ${r} 0 0 1 ${r} ${-r}h${grosor - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${y0}z` }));
      } else if (alto > 2) {
        // 2 px de separación con la parte de encima.
        barra.append(nodo('rect', { class: `aa-parte ${g.series[k].color}`, x, y: arriba + 2, width: grosor, height: alto - 2 }));
      }
      y0 = arriba;
    });
    grupo.append(barra);
    if (totales[i] > 0 && (caben || i === mayor)) grupo.append(nodo('text', { x: centro, y: yDe(totales[i]) - 7, 'text-anchor': 'middle', class: 'aa-cifra' }, g.formato(totales[i])));
    // Etiqueta del eje horizontal.
    if (g.tipo === 'cd') {
      if (inclinar) {
        grupo.append(nodo('text', { x: centro, y: base + 14, 'text-anchor': 'end', transform: `rotate(-40 ${centro} ${base + 14})`, class: 'aa-eje aa-eje-x' }, c.etiqueta));
      } else {
        const texto = nodo('text', { x: centro, y: base + 17, 'text-anchor': 'middle', class: 'aa-eje aa-eje-x' });
        lineas[i].forEach((l, k) => texto.append(nodo('tspan', { x: centro, dy: k ? 14 : 0 }, l)));
        grupo.append(texto);
      }
    } else if (i % saltar === 0) {
      grupo.append(nodo('text', { x: centro, y: base + 18, 'text-anchor': 'middle', class: 'aa-eje aa-eje-x' }, c.etiqueta));
    }
    const mostrar = (cx: number, cy: number) => {
      svg.classList.add('aa-enfoque');
      columnas.forEach((col, k) => col.classList.toggle('activa', k === i));
      mostrarTip(c.titulo, filasTip(g, c), cx, cy);
    };
    grupo.addEventListener('pointermove', evento => { g.foco = i; mostrar(evento.clientX, evento.clientY); });
    grupo.addEventListener('pointerleave', () => { svg.classList.remove('aa-enfoque'); grupo.classList.remove('activa'); ocultarTip(); });
    (grupo as SVGGElement & { mostrar?: () => void }).mostrar = () => {
      const caja = svg.getBoundingClientRect();
      mostrar(caja.left + centro, caja.top + yDe(totales[i]));
    };
    columnas.push(grupo);
    svg.append(grupo);
  });

  // Teclado: flechas para pasar de columna; la cifra también se anuncia al lector de pantalla.
  const enfocar = (i: number) => {
    g.foco = Math.max(0, Math.min(n - 1, i));
    (columnas[g.foco] as SVGGElement & { mostrar?: () => void }).mostrar?.();
    anuncio.textContent = textoColumna(g, g.columnas[g.foco]);
  };
  svg.addEventListener('focus', () => enfocar(Math.min(g.foco, n - 1)));
  svg.addEventListener('blur', () => { svg.classList.remove('aa-enfoque'); columnas.forEach(col => col.classList.remove('activa')); ocultarTip(); });
  svg.addEventListener('keydown', evento => {
    const pasos: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (evento.key in pasos) { evento.preventDefault(); enfocar(g.foco + pasos[evento.key]); }
    else if (evento.key === 'Home') { evento.preventDefault(); enfocar(0); }
    else if (evento.key === 'End') { evento.preventDefault(); enfocar(n - 1); }
    else if (evento.key === 'Escape') ocultarTip();
  });

  const partes: Node[] = [];
  const leyenda = leyendaDe(g);
  if (leyenda) partes.push(leyenda);
  partes.push(svg);
  g.caja.replaceChildren(...partes);
}

// Se redibuja al cambiar el ancho (en el siguiente cuadro, para no encadenar cambios de tamaño).
for (const g of Object.values(graficos)) {
  let cuadro = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(cuadro);
    cuadro = requestAnimationFrame(() => { if (Math.floor(g.caja.clientWidth) !== g.ancho) dibujar(g, false); });
  }).observe(g.caja);
}

for (const boton of document.querySelectorAll<HTMLButtonElement>('.aa-ver-tabla')) {
  boton.addEventListener('click', () => {
    const g = graficos[boton.dataset.grafico ?? ''];
    if (!g) return;
    g.enTabla = !g.enTabla;
    boton.setAttribute('aria-pressed', String(g.enTabla));
    boton.textContent = g.enTabla ? 'Ver gráfico' : 'Ver tabla';
    dibujar(g, false);
  });
}

function ponerColumnas(g: Grafico, columnas: Columna[], subtitulo: string) {
  g.columnas = columnas;
  g.foco = 0;
  g.subtitulo.textContent = subtitulo;
  dibujar(g);
}

const columnasPorCd = (r: ResumenActivos, refs: readonly Referencia[]): Columna[] =>
  [...r.porCd].map(([cd, fila]) => ({ etiqueta: cd, titulo: cd, valores: refs.map(ref => fila.cantidades[ref.clave]) }))
    .sort((a, b) => totalDe(b) - totalDe(a) || a.etiqueta.localeCompare(b.etiqueta, 'es'));

function columnasPorDia(r: ResumenActivos, refs: readonly Referencia[]): Columna[] {
  const dias = [...r.porDia.keys()].sort();
  if (!dias.length) return [];
  // Días seguidos, del primero al último con conteos: los días sin conteo quedan como hueco.
  return diasEntre(dias[0], dias[dias.length - 1]).map(dia => {
    const fila = r.porDia.get(dia);
    return { etiqueta: diaCorto(dia), titulo: `${nombreDia(dia)}, ${fecha(dia)}${fila ? '' : ' · sin conteos'}`, valores: refs.map(ref => fila?.cantidades[ref.clave] ?? 0) };
  });
}

function pintarGraficos(r: ResumenActivos) {
  const cds = r.porCd.size;
  const enCds = `${plural(cds, 'CD', 'CD')} · de mayor a menor`;
  ponerColumnas(graficos.cdEstibas, columnasPorCd(r, ESTIBAS), enCds);
  ponerColumnas(graficos.cdCajas, columnasPorCd(r, CAJAS), enCds);
  ponerColumnas(graficos.cdIsotanques, columnasPorCd(r, ISOTANQUES), enCds);
  ponerColumnas(graficos.cdHl, columnasPorCd(r, [HL]), enCds);
  const dias = r.porDia.size;
  const enDias = plural(dias, 'día con conteos', 'días con conteos');
  ponerColumnas(graficos.diaEstibas, columnasPorDia(r, ESTIBAS), enDias);
  ponerColumnas(graficos.diaCajas, columnasPorDia(r, CAJAS), enDias);
  ponerColumnas(graficos.diaIsotanques, columnasPorDia(r, ISOTANQUES), enDias);
  ponerColumnas(graficos.diaHl, columnasPorDia(r, [HL]), enDias);
  // Con un solo día, los gráficos por día muestran una sola columna: se invita a ampliar el rango.
  porId('aaDiaNota').hidden = dias !== 1;
  if (dias === 1) porId('aaDiaNotaTexto').textContent = filtro.desde === filtro.hasta ? 'El rango elegido es un solo día, así que cada gráfico muestra una sola columna.' : 'En este rango solo hay conteos de un día.';
}

// ---------- Tabla por CD ----------

const COLUMNAS_TABLA = [...ESTIBAS, ...CAJAS, ...ISOTANQUES, { clave: 'necesidad_isotanques', nombre: 'Necesidad de isotanques', corto: 'Necesidad' }, HL] as const;
const FIN_GRUPO = new Set(['estibas_c', 'cajas_225cc_x38', 'necesidad_isotanques']);

/** Ícono lleno (ubicación del CD o gota de HL) para la tabla por CD. */
function iconoTabla(cual: 'pin' | 'gota'): SVGSVGElement {
  const svg = nodo('svg', { viewBox: '0 0 24 24', class: 'aa-ico aa-ico-lleno', 'aria-hidden': 'true' });
  if (cual === 'pin') {
    svg.append(nodo('path', { d: 'M12 21.5s-7-6-7-11.6a7 7 0 0 1 14 0c0 5.6-7 11.6-7 11.6z' }), nodo('circle', { class: 'aa-ico-hueco', cx: 12, cy: 9.8, r: 2.6 }));
  } else svg.append(nodo('path', { d: 'M12 3.2s6.2 6.6 6.2 11a6.2 6.2 0 0 1-12.4 0c0-4.4 6.2-11 6.2-11Z' }));
  return svg;
}

/** Celdas de cantidades de una fila; en la de total, los HL van en una píldora negra con su gota. */
function celdasDe(fila: HTMLTableRowElement, c: Cantidades, total = false) {
  for (const col of COLUMNAS_TABLA) {
    const v = c[col.clave];
    const hl = col.clave === 'hl_pendientes_verter';
    const texto = hl ? cifraHl(v) : cifra(v);
    const td = crear('td', `num${FIN_GRUPO.has(col.clave) ? ' aa-fin-grupo' : ''}${v ? '' : ' aa-cero'}${hl ? ' aa-td-hl' : ''}`, total && hl ? undefined : texto);
    if (total && hl) {
      const pildora = crear('span', 'aa-hl-total');
      pildora.append(iconoTabla('gota'), crear('b', undefined, texto));
      td.append(pildora);
    }
    fila.append(td);
  }
}

function pintarTabla(r: ResumenActivos) {
  const filas = [...r.porCd].sort(([a], [b]) => a.localeCompare(b, 'es'));
  porId('aaTablaCuerpo').replaceChildren(...filas.map(([cd, f], i) => {
    const fila = crear('tr');
    fila.style.setProperty('--f', String(i));
    const th = crear('th', 'aa-td-cd');
    th.scope = 'row';
    const nombre = crear('span', 'aa-cd-nombre');
    nombre.append(crear('b', undefined, cd), crear('small', undefined, plural(f.conteos, 'conteo', 'conteos')));
    th.append(iconoTabla('pin'), nombre);
    fila.append(th);
    celdasDe(fila, f.cantidades);
    return fila;
  }));
  const pie = crear('tr');
  const th = crear('th', 'aa-td-cd');
  th.scope = 'row';
  const sigma = crear('span', 'aa-sigma', 'Σ');
  sigma.setAttribute('aria-hidden', 'true');
  th.append(sigma, 'Total');
  pie.append(th);
  celdasDe(pie, r.total, true);
  porId('aaTablaPie').replaceChildren(pie);
  porId('aaTablaSub').textContent = `${textoPeriodo(filtro.desde, filtro.hasta)} · ${plural(filas.length, 'CD', 'CD')} · suma de ${plural(r.conteos, 'conteo', 'conteos')}`;
  const faltan = filtro.cd ? [] : CDS_REGIONAL_NORTE.filter(cd => !r.porCd.has(cd));
  const sin = porId('aaSinConteo');
  sin.hidden = !faltan.length;
  sin.textContent = faltan.length ? `Sin conteo en el periodo (${faltan.length}): ${faltan.join(', ')}.` : '';
}

// ---------- Filtros ----------

function rellenarMeses() {
  const meses = registros ? mesesConConteos(registros) : [];
  const actual = hoy().slice(0, 7);
  if (!meses.includes(actual)) meses.unshift(actual);
  campoMes.replaceChildren(new Option('Elegir mes', ''), ...meses.map(m => new Option(mayuscula(formatoMes.format(fechaDe(`${m}-01`))), m)));
}

/** Pone el rango del atajo elegido. */
function aplicarAtajo(nuevo: Atajo) {
  atajo = nuevo;
  const h = hoy();
  if (atajo === 'ultimo') {
    const dia = (registros && (ultimoDiaConConteos(registros, filtro.cd) ?? ultimoDiaConConteos(registros))) || h;
    filtro.desde = filtro.hasta = dia;
  } else if (atajo === 'semana') { filtro.desde = sumarDias(h, -6); filtro.hasta = h; }
  else if (atajo === 'mes') { filtro.desde = `${h.slice(0, 7)}-01`; filtro.hasta = h; }
  else if (atajo === 'todo') { filtro.desde = (registros && primerDiaConConteos(registros)) || h; filtro.hasta = h; }
}

/** Los campos muestran el filtro actual; el mes se marca si el rango es justo un mes. */
function pintarFiltros() {
  const h = hoy();
  campoDesde.value = filtro.desde;
  campoHasta.value = filtro.hasta;
  campoDesde.max = campoHasta.max = h;
  campoCd.value = filtro.cd;
  const mes = filtro.desde.slice(0, 7);
  const esMes = filtro.desde === `${mes}-01` && (filtro.hasta === finDeMes(mes) || (mes === h.slice(0, 7) && filtro.hasta === h));
  campoMes.value = esMes && [...campoMes.options].some(o => o.value === mes) ? mes : '';
  for (const boton of document.querySelectorAll<HTMLButtonElement>('.aa-atajo')) {
    boton.setAttribute('aria-pressed', String(boton.dataset.atajo === atajo));
  }
  const ultimo = registros && ultimoDiaConConteos(registros, filtro.cd);
  document.querySelector<HTMLButtonElement>('[data-atajo="ultimo"]')!.title = ultimo ? `Último día con conteos${filtro.cd ? ` de ${filtro.cd}` : ''}: ${fecha(ultimo)}` : 'Aún no hay conteos';
}

function alCambiarFechas() {
  let desde = campoDesde.value || campoHasta.value;
  let hasta = campoHasta.value || campoDesde.value;
  if (!desde) return;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  filtro.desde = desde;
  filtro.hasta = hasta;
  atajo = '';
  pintar();
}
campoDesde.addEventListener('change', alCambiarFechas);
campoHasta.addEventListener('change', alCambiarFechas);
campoCd.addEventListener('change', () => {
  filtro.cd = campoCd.value;
  if (atajo === 'ultimo') aplicarAtajo('ultimo');
  pintar();
});
campoMes.addEventListener('change', () => {
  const mes = campoMes.value;
  if (!mes) return;
  const h = hoy();
  filtro.desde = `${mes}-01`;
  filtro.hasta = finDeMes(mes) > h ? h : finDeMes(mes);
  atajo = mes === h.slice(0, 7) ? 'mes' : '';
  pintar();
});
for (const boton of document.querySelectorAll<HTMLButtonElement>('.aa-atajo')) {
  boton.addEventListener('click', () => { aplicarAtajo(boton.dataset.atajo as Atajo); pintar(); });
}
porId('aaActualizar').addEventListener('click', () => void cargar());
porId('aaDiaSemana').addEventListener('click', () => { aplicarAtajo('semana'); pintar(); });
porId('aaVacioUltimo').addEventListener('click', () => { aplicarAtajo('ultimo'); pintar(); });
porId('aaVacioTodos').addEventListener('click', () => {
  filtro.cd = '';
  if (atajo === 'ultimo') aplicarAtajo('ultimo');
  pintar();
});

// ---------- Pintar todo ----------

function pintarResumen(r: ResumenActivos) {
  const partes = [textoPeriodo(filtro.desde, filtro.hasta)];
  if (filtro.cd) partes.unshift(filtro.cd);
  if (!r.conteos) partes.push('sin conteos');
  else {
    if (!filtro.cd) partes.push(`${r.porCd.size} de ${CDS_REGIONAL_NORTE.length} CD con conteo`);
    partes.push(`suma de ${plural(r.conteos, 'conteo', 'conteos')}`);
  }
  const texto = crear('span', undefined, partes.join(' · '));
  const hijos: Node[] = [texto];
  // "Último día" puede caer antes de hoy: se avisa para que no parezca el inventario de hoy.
  const h = hoy();
  if (atajo === 'ultimo' && r.conteos && filtro.desde !== h) {
    hijos.push(crear('span', 'aa-resumen-nota aa-resumen-aviso', `${filtro.cd ? `${filtro.cd} no tiene` : 'No hay'} conteos de hoy: se muestra el último día con conteos.`));
  }
  if (r.repetidos) {
    const nota = crear('span', 'aa-resumen-nota', `${plural(r.repetidos, 'reenvío', 'reenvíos')} del mismo día no se ${r.repetidos === 1 ? 'suma' : 'suman'}: de cada CD cuenta el último conteo del día.`);
    hijos.push(nota);
  }
  if (truncado) hijos.push(crear('span', 'aa-resumen-nota', 'Se consultaron solo los 5.000 conteos más recientes.'));
  resumenTexto.dataset.tipo = '';
  resumenTexto.replaceChildren(...hijos);
}

function pintarVacio(r: ResumenActivos) {
  const vacio = porId('aaVacio');
  const sinNada = !registros?.length;
  vacio.hidden = r.conteos > 0;
  tablero.hidden = r.conteos === 0;
  if (r.conteos > 0) return;
  const ultimo = registros ? ultimoDiaConConteos(registros, filtro.cd) : null;
  const botonUltimo = porId<HTMLButtonElement>('aaVacioUltimo');
  porId('aaVacioTitulo').textContent = sinNada ? 'Aún no hay conteos de inventario' : 'Sin conteos en este periodo';
  porId('aaVacioTexto').textContent = sinNada
    ? 'Los conteos se registran en Control de inventarios. Apenas un CD envíe el primero, aquí verás las estibas, estibas plásticas e isotanques.'
    : `${filtro.cd ? `${filtro.cd} no tiene` : 'No hay'} conteos ${enElPeriodo(filtro.desde, filtro.hasta)}.${ultimo ? ` El último fue el ${fecha(ultimo)}.` : filtro.cd ? ` ${filtro.cd} aún no ha enviado ninguno.` : ''}`;
  botonUltimo.hidden = !ultimo || (filtro.desde === ultimo && filtro.hasta === ultimo);
  if (ultimo) botonUltimo.textContent = `Ver el ${fecha(ultimo)}`;
  porId('aaVacioTodos').hidden = sinNada || !filtro.cd;
  porId('aaVacioRegistrar').hidden = !sinNada;
}

function pintar() {
  if (!registros) return;
  pintarFiltros();
  const r = resumirActivos(registros, filtro);
  pintarResumen(r);
  pintarTotales(r);
  pintarVacio(r);
  if (!r.conteos) { ocultarTip(); return; }
  pintarDona(donas.estibas, r.total);
  pintarDona(donas.cajas, r.total);
  pintarDona(donas.isotanques, r.total);
  pintarGraficos(r);
  pintarTabla(r);
}

// ---------- Carga ----------

function cargar(): Promise<void> {
  cargando ??= (async () => {
    // Mientras se consulta, lo de antes se queda a media luz (sin saltos ni pantallas en blanco).
    document.body.classList.add('aa-cargando');
    porId<HTMLButtonElement>('aaActualizar').disabled = true;
    try {
      const respuesta = await fetch('/api/formularios/respuestas?formulario=control-inventarios');
      if (respuesta.status === 401) { location.replace('/'); return; }
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.error || 'No se pudieron consultar los conteos de inventario.');
      const primeraVez = !registros;
      registros = (datos.respuestas ?? []) as Conteo[];
      truncado = !!datos.truncado;
      rellenarMeses();
      if (primeraVez || atajo) aplicarAtajo(atajo || 'ultimo');
      pintar();
    } catch (error) {
      resumenTexto.dataset.tipo = 'error';
      resumenTexto.textContent = error instanceof TypeError ? SIN_CONEXION : (error as Error).message;
    } finally {
      document.body.classList.remove('aa-cargando');
      porId<HTMLButtonElement>('aaActualizar').disabled = false;
      cargando = null;
    }
  })();
  return cargando;
}

campoCd.append(...CDS_REGIONAL_NORTE.map(cd => new Option(cd, cd)));
rellenarMeses();
void cargar();

// Módulo Bajas: movimientos de bajas de SAP (un Excel por mes). Trae del servidor todas las cargas juntas (en columnas)
// y calcula TODO en el navegador con src/shared/bajas.ts (ahí viven las reglas; aquí solo se dibuja).
// Tarjetas, tendencia mensual por tipo, bajas por motivo, por día, por gerencia, por CD, los 10 materiales con más bajas,
// el mapa CD × mes y el detalle de movimientos. Misma familia visual que Seguimiento T1 (usa t1.css). Tema, usuario y
// salida: modulos.ts.
import { porId } from './dom';
import { DIAS_SEMANA, MESES, diaDeIso, fechaDeDia, isoDeDia } from '../shared/t1';
import { GRUPOS, NOMBRE_GRUPO, calcularBajas, filasBajas, opcionesBajas } from '../shared/bajas';
import type { ColumnasBajas, FilaBaja, FiltrosBajas, Grupo, ResultadoBajas } from '../shared/bajas';
import type { RespuestaWorkerCargas } from './cargas-worker';

const SVG = 'http://www.w3.org/2000/svg';
const SIN_CONEXION = 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.';

// ---------- Formatos ----------

const cifra = (n: number) => Math.round(n).toLocaleString('es-CO');
const formatoPesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
/** "$ 1.234.567" (completo, para la ventanita y la tabla). */
const pesos = (v: number) => formatoPesos.format(Math.round(v));
/** "$1.279,6 M" (millones, para las cifras de los gráficos). */
const millones = (v: number) => `${v < 0 ? '−' : ''}$${(Math.abs(v) / 1e6).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;
const ejeMillones = (v: number) => `$${(v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 0 })} M`;
const formatoFecha = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const fecha = (dia: number) => formatoFecha.format(fechaDeDia(dia));
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const diaCorto = (dia: number) => { const f = fechaDeDia(dia); return `${f.getUTCDate()} ${MES_CORTO[f.getUTCMonth()]}`; };
const fechaLarga = (dia: number) => `${mayuscula(DIAS_SEMANA[fechaDeDia(dia).getUTCDay()])}, ${fecha(dia)}`;
const nombreMes = (mes: string) => `${mayuscula(MESES[Number(mes.slice(5, 7)) - 1])} ${mes.slice(0, 4)}`;
const mesCorto = (mes: string) => mayuscula(MES_CORTO[Number(mes.slice(5, 7)) - 1]);
const plural = (n: number, uno: string, varios: string) => `${cifra(n)} ${n === 1 ? uno : varios}`;
const mesDeDia = (dia: number) => isoDeDia(dia).slice(0, 7);
function finDeMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number);
  return diaDeIso(`${mes}-01`) + new Date(Date.UTC(a, m, 0)).getUTCDate() - 1;
}
const primerDiaMes = (dia: number) => diaDeIso(`${mesDeDia(dia)}-01`);
const formatoMomento = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
const porTexto = new Intl.Collator('es', { numeric: true }).compare;
const anchoTexto = (texto: string, tamano = 11.5) => texto.length * tamano * 0.58;

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

// ---------- Colores ----------

/** Un color por tipo de baja (el mismo en la tendencia mensual, los motivos y la ventanita). */
const COLOR_GRUPO: Record<Grupo, string> = { producto: '#ef4444', transporte: '#f59e0b', ajustes: '#3b82f6', otros: '#94a3b8' };
const COLOR_BAJA = '#ef5a4c';
/** Un valor negativo (las entradas o anulaciones superan las bajas) va en verde. */
const COLOR_GANANCIA = '#22c55e';

// ---------- Estado ----------

interface Filtro { desde: number; hasta: number; cds: string[]; motivos: string[] }
interface Carga { archivo: string; filas: number; desde: string; hasta: string; usuario_nombre: string | null; creado_en: string; cargas?: number }
type Opciones = ReturnType<typeof opcionesBajas>;

let filas: FilaBaja[] | null = null;
let opciones: Opciones | null = null;
let carga: Carga | null = null;
let resultado: ResultadoBajas | null = null;
const filtro: Filtro = { desde: 0, hasta: 0, cds: [], motivos: [] };
let rangoPorDefecto = true;
let cargando: Promise<void> | null = null;

const anuncio = porId('bjAnuncio');
const resumenTexto = porId('bjResumen');
const tablero = porId('bjTablero');
const campoDesde = porId<HTMLInputElement>('bjDesde');
const campoHasta = porId<HTMLInputElement>('bjHasta');
const campoMes = porId<HTMLSelectElement>('bjMes');
const nombreMotivo = (m: string) => opciones?.motivos.find(x => x.motivo === m)?.nombre ?? m;

// ---------- Ventanita de detalle ----------

const tip = porId('bjTip');
interface FilaTip { nombre: string; valor: string; color?: string; fuerte?: boolean }
function mostrarTip(titulo: string, filasTip: readonly FilaTip[], x: number, y: number, pista?: string) {
  const lista = crear('dl', 't1-tip-filas');
  for (const f of filasTip) {
    const dt = crear('dt', f.fuerte ? 't1-tip-total' : undefined);
    if (f.color) { const i = crear('i', 't1-tip-clave'); i.style.setProperty('--c', f.color); dt.append(i); }
    dt.append(f.nombre);
    lista.append(dt, crear('dd', f.fuerte ? 't1-tip-total' : undefined, f.valor));
  }
  tip.replaceChildren(crear('strong', 't1-tip-titulo', titulo), lista);
  if (pista) tip.append(crear('p', 't1-tip-pista', pista));
  tip.hidden = false;
  const caja = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(8, x - caja.width / 2), innerWidth - caja.width - 8)}px`;
  tip.style.top = `${y - caja.height - 14 < 8 ? y + 18 : y - caja.height - 14}px`;
}
const ocultarTip = () => { tip.hidden = true; };
addEventListener('scroll', ocultarTip, { passive: true });

// ---------- Gráficos (SVG propio) ----------

/** Marcas "redondas" del eje (unas 4 o 5) entre el mínimo (0 o negativo) y el máximo. */
function marcasEje(min: number, max: number): number[] {
  const alto = Math.max(max - min, 1);
  const bruto = alto / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map(f => f * potencia).find(p => p >= bruto) ?? 10 * potencia;
  const desde = Math.floor(min / paso) * paso;
  const marcas = [desde];
  while (marcas[marcas.length - 1] < max - 1e-9) marcas.push(marcas[marcas.length - 1] + paso);
  return marcas;
}
const vacio = (texto = 'Sin bajas con estos filtros.') => crear('p', 't1-grafico-vacio', texto);

interface Barra { clave: string; etiqueta: string; titulo: string; valor: number; color: string; filas: FilaTip[]; elegida?: boolean }
/** Barras horizontales, de mayor a menor; con "alTocar", un clic filtra la página por esa barra. */
function dibujarBarras(caja: HTMLElement, barras: Barra[], alTocar?: (b: Barra) => void) {
  const ancho = Math.floor(caja.clientWidth);
  if (!ancho) return;
  if (!barras.length) { caja.replaceChildren(vacio()); return; }
  const FILA = barras.length > 12 ? 24 : 30, GROSOR = barras.length > 12 ? 14 : 18;
  const IZQ = Math.round(Math.min(ancho * 0.45, Math.max(...barras.map(b => anchoTexto(b.etiqueta, 12))) + 18));
  const DER = Math.round(Math.max(...barras.map(b => anchoTexto(millones(b.valor), 11.5))) + 14);
  const alto = barras.length * FILA + 8;
  const tope = Math.max(1, ...barras.map(b => Math.abs(b.valor)));
  const largo = Math.max(40, ancho - IZQ - DER);
  const hayEleccion = barras.some(b => b.elegida);
  const svg = nodo('svg', { width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}`, class: `bj-svg${alTocar ? ' bj-filtra' : ''}`, role: 'img' });
  svg.setAttribute('aria-label', barras.map(b => `${b.titulo}: ${millones(b.valor)}`).join('. '));
  svg.append(nodo('line', { x1: IZQ, x2: IZQ, y1: 0, y2: alto, class: 'bj-base' }));
  barras.forEach((b, i) => {
    const y = 4 + i * FILA, centro = y + FILA / 2;
    const g = nodo('g', { class: `bj-marca${b.elegida ? ' bj-elegida' : ''}${hayEleccion && !b.elegida ? ' bj-atenuada' : ''}` });
    g.append(nodo('rect', { x: 0, y: y + 1, width: ancho, height: FILA - 2, rx: 6, class: 'bj-zona' }));
    g.append(nodo('text', { x: IZQ - 9, y: centro, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'bj-eje bj-eje-cat' }, b.etiqueta));
    const w = Math.max(b.valor ? 2 : 0, (Math.abs(b.valor) / tope) * largo);
    g.append(nodo('rect', { x: IZQ, y: centro - GROSOR / 2, width: w, height: GROSOR, rx: 4, class: 'bj-barra', style: `--c:${b.valor < 0 ? COLOR_GANANCIA : b.color}` }));
    g.append(nodo('text', { x: IZQ + w + 6, y: centro, 'dominant-baseline': 'central', class: 'bj-cifra' }, millones(b.valor)));
    g.addEventListener('pointermove', e => mostrarTip(b.titulo, b.filas, e.clientX, e.clientY, alTocar ? (b.elegida ? 'Clic para quitar este filtro' : 'Clic para filtrar toda la página') : undefined));
    g.addEventListener('pointerleave', ocultarTip);
    if (alTocar) g.addEventListener('click', () => { ocultarTip(); alTocar(b); });
    svg.append(g);
  });
  caja.replaceChildren(svg);
}

interface Columna { etiqueta: string; titulo: string; partes: { valor: number; color: string; nombre: string }[]; total: number }
/** Columnas (apiladas si tienen varias partes), con el total encima y el eje en millones. */
function dibujarColumnas(caja: HTMLElement, columnas: Columna[], alto = 220) {
  const ancho = Math.floor(caja.clientWidth);
  if (!ancho) return;
  if (!columnas.length) { caja.replaceChildren(vacio()); return; }
  // Lo positivo se apila hacia arriba y lo negativo hacia abajo (p. ej. un mes con más entradas que bajas).
  const arriba = columnas.map(c => c.partes.reduce((s, p) => s + Math.max(0, p.valor), 0));
  const abajo = columnas.map(c => c.partes.reduce((s, p) => s + Math.min(0, p.valor), 0));
  const marcas = marcasEje(Math.min(0, ...abajo), Math.max(1, ...arriba) * 1.08);
  const min = marcas[0], max = marcas[marcas.length - 1];
  const IZQ = Math.round(Math.max(...marcas.map(m => anchoTexto(ejeMillones(m)))) + 12), DER = 6, ARRIBA = 20, ABAJO = 26;
  const largo = Math.max(60, ancho - IZQ - DER), hueco = largo / columnas.length;
  const grosor = Math.max(3, Math.min(46, hueco * 0.62));
  const yDe = (v: number) => ARRIBA + ((max - v) / (max - min)) * alto;
  const svg = nodo('svg', { width: ancho, height: alto + ARRIBA + ABAJO, viewBox: `0 0 ${ancho} ${alto + ARRIBA + ABAJO}`, class: 'bj-svg', role: 'img' });
  svg.setAttribute('aria-label', columnas.map(c => `${c.titulo}: ${millones(c.total)}`).join('. '));
  for (const m of marcas) {
    svg.append(nodo('line', { x1: IZQ, x2: ancho - DER, y1: yDe(m), y2: yDe(m), class: m === 0 ? 'bj-base' : 'bj-guia' }));
    svg.append(nodo('text', { x: IZQ - 7, y: yDe(m), 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'bj-eje' }, ejeMillones(m)));
  }
  const saltar = Math.max(1, Math.ceil((Math.max(...columnas.map(c => anchoTexto(c.etiqueta))) + 8) / hueco));
  const cifras = columnas.every(c => anchoTexto(millones(c.total), 10.5) <= hueco + 4);
  columnas.forEach((c, i) => {
    const centro = IZQ + hueco * (i + 0.5), x = centro - grosor / 2;
    const g = nodo('g', { class: 'bj-marca' });
    g.append(nodo('rect', { x: IZQ + hueco * i + 1, y: ARRIBA - 14, width: Math.max(1, hueco - 2), height: alto + 14 + ABAJO - 4, rx: 6, class: 'bj-zona' }));
    let sube = 0, baja = 0;
    for (const p of c.partes) {
      if (!p.valor) continue;
      const desde = p.valor > 0 ? sube : baja, hasta = desde + p.valor;
      if (p.valor > 0) sube = hasta; else baja = hasta;
      const y1 = yDe(Math.max(desde, hasta)), y2 = yDe(Math.min(desde, hasta));
      g.append(nodo('rect', { x, y: y1, width: grosor, height: Math.max(0.5, y2 - y1 - 1), rx: 2, class: 'bj-barra', style: `--c:${p.valor < 0 ? COLOR_GANANCIA : p.color}` }));
    }
    if (cifras) g.append(nodo('text', { x: centro, y: yDe(Math.max(0, c.total, sube)) - 6, 'text-anchor': 'middle', class: 'bj-cifra bj-cifra-col' }, millones(c.total)));
    if (i % saltar === 0) g.append(nodo('text', { x: centro, y: ARRIBA + alto + 16, 'text-anchor': 'middle', class: 'bj-eje bj-eje-x' }, c.etiqueta));
    const filasTip: FilaTip[] = c.partes.length > 1
      ? [...c.partes.filter(p => p.valor).map(p => ({ nombre: p.nombre, valor: millones(p.valor), color: p.color })), { nombre: 'Total', valor: pesos(c.total), fuerte: true }]
      : [{ nombre: 'Valor neto', valor: pesos(c.total), fuerte: true }];
    g.addEventListener('pointermove', e => mostrarTip(c.titulo, filasTip, e.clientX, e.clientY));
    g.addEventListener('pointerleave', ocultarTip);
    svg.append(g);
  });
  caja.replaceChildren(svg);
}

function leyenda(items: { nombre: string; color: string }[]): HTMLElement {
  const ul = crear('ul', 't1-leyenda');
  for (const it of items) {
    const li = crear('li');
    const m = crear('i', 't1-muestra');
    m.style.setProperty('--c', it.color);
    li.append(m, it.nombre);
    ul.append(li);
  }
  return ul;
}

// Cada gráfico se vuelve a dibujar si cambia de ancho.
const dibujos = new Map<HTMLElement, () => void>();
const vigia = new ResizeObserver(entradas => {
  for (const e of entradas) {
    const caja = e.target as HTMLElement;
    const ancho = Math.floor(caja.clientWidth);
    if (String(ancho) !== caja.dataset.ancho) { caja.dataset.ancho = String(ancho); dibujos.get(caja)?.(); }
  }
});
function ponerDibujo(id: string, dibujo: () => void) {
  const caja = porId(id);
  if (!dibujos.has(caja)) vigia.observe(caja);
  dibujos.set(caja, dibujo);
  caja.dataset.ancho = String(Math.floor(caja.clientWidth));
  dibujo();
}

// ---------- Pintar ----------

function pintarTarjetas(r: ResultadoBajas) {
  const t = r.tarjetas;
  porId('bjKpiValor').textContent = t.movimientos ? millones(t.valor) : '—';
  porId('bjKpiValor').title = pesos(t.valor);
  porId('bjKpiUnidades').textContent = t.movimientos ? cifra(t.unidades) : '—';
  porId('bjKpiMov').textContent = t.movimientos ? cifra(t.movimientos) : '—';
  porId('bjKpiAnulado').textContent = t.movimientos ? millones(t.anulado) : '—';
  porId('bjKpiAnulado').title = pesos(t.anulado);
}

const filasSuma = (s: { valor: number; unidades: number; movimientos: number }, extra: FilaTip[] = []): FilaTip[] => [
  ...extra, { nombre: 'Unidades', valor: cifra(s.unidades) }, { nombre: 'Movimientos', valor: cifra(s.movimientos) }, { nombre: 'Valor neto', valor: pesos(s.valor), fuerte: true },
];

function pintarGraficos(r: ResultadoBajas) {
  // Tendencia mensual (todos los meses), apilada por tipo.
  const gruposConDatos = GRUPOS.filter(g => r.mensual.some(m => m.grupos[g]));
  porId('bjGMesS').textContent = `${plural(r.mensual.length, 'mes', 'meses')} · no le afecta el rango de fechas`;
  ponerDibujo('bjGMes', () => {
    const caja = porId('bjGMes');
    const columnas: Columna[] = r.mensual.map(m => ({
      etiqueta: mesCorto(m.mes), titulo: nombreMes(m.mes), total: m.total,
      partes: gruposConDatos.map(g => ({ valor: m.grupos[g], color: COLOR_GRUPO[g], nombre: NOMBRE_GRUPO[g] })),
    }));
    const dibujo = crear('div');
    caja.replaceChildren(leyenda(gruposConDatos.map(g => ({ nombre: NOMBRE_GRUPO[g], color: COLOR_GRUPO[g] }))), dibujo);
    dibujarColumnas(dibujo, columnas, 230);
  });

  porId('bjGMotS').textContent = `${plural(r.porMotivo.length, 'motivo', 'motivos')} · de mayor a menor`;
  ponerDibujo('bjGMot', () => dibujarBarras(porId('bjGMot'), r.porMotivo.map(m => ({
    clave: m.motivo, etiqueta: m.nombre, titulo: `${m.nombre} · ${NOMBRE_GRUPO[m.grupo]}`, valor: m.valor, color: COLOR_GRUPO[m.grupo],
    filas: filasSuma(m), elegida: filtro.motivos.includes(m.motivo),
  })), b => alternar('motivos', b.clave)));

  porId('bjGDiaS').textContent = r.diaria.length ? `${plural(r.diaria.length, 'día', 'días')} con movimientos` : '';
  ponerDibujo('bjGDia', () => {
    if (!r.diaria.length) { porId('bjGDia').replaceChildren(vacio()); return; }
    // Todos los días del rango (los que no tienen movimientos quedan en cero).
    const porDia = new Map(r.diaria.map(d => [d.fecha, d]));
    const columnas: Columna[] = [];
    for (let d = filtro.desde; d <= filtro.hasta; d++) {
      const v = porDia.get(d);
      columnas.push({ etiqueta: diaCorto(d), titulo: fechaLarga(d), total: v?.valor ?? 0, partes: [{ valor: v?.valor ?? 0, color: COLOR_BAJA, nombre: 'Valor neto' }] });
    }
    dibujarColumnas(porId('bjGDia'), columnas, 200);
  });

  porId('bjGGerS').textContent = `${plural(r.porGerencia.length, 'gerencia', 'gerencias')} · de mayor a menor`;
  ponerDibujo('bjGGer', () => dibujarBarras(porId('bjGGer'), r.porGerencia.map(g => ({
    clave: g.gerencia, etiqueta: g.gerencia, titulo: `Gerencia ${g.gerencia}`, valor: g.valor, color: COLOR_BAJA, filas: filasSuma(g),
  }))));

  porId('bjGCdS').textContent = `${plural(r.porCd.length, 'CD', 'CD')} · de mayor a menor`;
  ponerDibujo('bjGCd', () => dibujarBarras(porId('bjGCd'), r.porCd.map(c => ({
    clave: c.cd, etiqueta: c.cd, titulo: c.gerencia ? `${c.cd} · gerencia ${c.gerencia}` : c.cd, valor: c.valor, color: COLOR_BAJA,
    filas: filasSuma(c), elegida: filtro.cds.includes(c.cd),
  })), b => alternar('cds', b.clave)));

  const top = r.materiales.slice(0, 10);
  porId('bjGMatS').textContent = `de ${plural(r.materiales.length, 'material', 'materiales')} · por valor neto`;
  ponerDibujo('bjGMat', () => dibujarBarras(porId('bjGMat'), top.map(m => ({
    clave: m.material, etiqueta: m.descripcion.length > 30 ? `${m.descripcion.slice(0, 29)}…` : m.descripcion, titulo: `${m.material} · ${m.descripcion}`,
    valor: m.valor, color: '#f97316', filas: filasSuma(m),
  }))));
}

/** Mapa CD × mes en millones: más intenso cuanto más valor; total por CD a la derecha y la fila Regional abajo. */
function pintarMapa(r: ResultadoBajas) {
  const { cds, meses, valores, total, regional, regionalTotal } = r.mapa;
  porId('bjMapaS').textContent = `${plural(cds.length, 'CD', 'CD')} × ${plural(meses.length, 'mes', 'meses')} · no le afecta el rango de fechas`;
  const caja = porId('bjMapa');
  if (!cds.length) { caja.replaceChildren(vacio()); return; }
  // Cada parte del mapa tiene su propia escala de rojo: las celdas de cada mes, la columna Total y la fila Regional
  // (con una sola escala, los totales siempre salían al máximo y las celdas de mes casi en blanco).
  const tope = (lista: number[]) => lista.reduce((a, b) => Math.max(a, b), 1);
  const topeMes = tope(valores.flat()), topeTotal = tope(total), topeRegional = tope(regional);
  const tabla = crear('table', 'bj-mapa');
  const cabeza = tabla.createTHead().insertRow();
  cabeza.append(crear('th', 'bj-mapa-cd', 'CD'), ...meses.map(m => crear('th', undefined, mesCorto(m))), crear('th', 'bj-mapa-total', 'Total'));
  const celda = (v: number, escala: number, clase = '') => {
    // En millones con un decimal; lo que redondea a cero sale "0,0" (sin el "-0,0" de una entrada mínima).
    const m = Math.round(v / 1e5) / 10 || 0;
    const td = crear('td', `num${clase}`, v ? m.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
    if (m > 0) td.style.setProperty('--bj-calor', String(Math.min(1, v / escala)));
    if (m < 0) td.classList.add('bj-mapa-neg');
    td.title = pesos(v);
    return td;
  };
  const cuerpo = tabla.createTBody();
  cds.forEach((cd, i) => {
    const tr = cuerpo.insertRow();
    tr.append(crear('th', 'bj-mapa-cd', cd), ...valores[i].map(v => celda(v, topeMes, ' bj-mapa-celda')), celda(total[i], topeTotal, ' bj-mapa-total'));
  });
  const pie = tabla.createTFoot().insertRow();
  pie.append(crear('th', 'bj-mapa-cd', 'Regional'), ...regional.map(v => celda(v, topeRegional)), celda(regionalTotal, regionalTotal, ' bj-mapa-total'));
  const desliza = crear('div', 'bj-mapa-scroll');
  desliza.tabIndex = 0;
  desliza.setAttribute('role', 'region');
  desliza.setAttribute('aria-label', 'Bajas por CD y mes en millones de pesos');
  desliza.append(tabla);
  caja.replaceChildren(desliza);
}

// Detalle: movimientos del periodo, de mayor a menor valor, con búsqueda y páginas.
const POR_PAGINA = 15;
let paginaDetalle = 0;
const buscar = porId<HTMLInputElement>('bjBuscar');
function pintarDetalle() {
  const caja = porId('bjDetalle');
  if (!resultado) return;
  const texto = buscar.value.trim().toLocaleLowerCase('es');
  const lista = texto
    ? resultado.detalle.filter(f => `${f.material} ${f.descripcion} ${f.documento} ${f.usuario} ${f.cabecera}`.toLocaleLowerCase('es').includes(texto))
    : resultado.detalle;
  porId('bjDetS').textContent = `${plural(lista.length, 'movimiento', 'movimientos')} del periodo · de mayor a menor valor`;
  if (!lista.length) { caja.replaceChildren(vacio(texto ? 'Ningún movimiento coincide con la búsqueda.' : undefined)); return; }
  const paginas = Math.ceil(lista.length / POR_PAGINA);
  paginaDetalle = Math.min(paginaDetalle, paginas - 1);
  const tabla = crear('table', 'bj-detalle');
  const cabeza = tabla.createTHead().insertRow();
  for (const [t, num] of [['Fecha', false], ['CD', false], ['Motivo', false], ['Material', false], ['Unidades', true], ['Valor', true], ['Documento', false], ['Usuario', false]] as const) {
    cabeza.append(crear('th', num ? 'num' : undefined, t));
  }
  const cuerpo = tabla.createTBody();
  for (const f of lista.slice(paginaDetalle * POR_PAGINA, (paginaDetalle + 1) * POR_PAGINA)) {
    const tr = cuerpo.insertRow();
    const motivo = crear('td');
    motivo.append(crear('span', 'bj-motivo', f.nombreMotivo));
    if (f.anulacion) motivo.append(crear('small', 'bj-anula', 'anulación'));
    motivo.title = `${f.cmv}${f.cabecera ? ` · ${f.cabecera}` : ''}`;
    const material = crear('td', 'bj-material');
    material.append(crear('b', undefined, f.descripcion), crear('small', undefined, `${f.material}${f.almacen ? ` · alm. ${f.almacen}` : ''}`));
    const valor = crear('td', `num${f.valor < 0 ? ' bj-neg' : ''}`, pesos(f.valor));
    tr.append(crear('td', 'bj-fecha', fecha(f.fecha)), crear('td', undefined, f.cd), motivo, material, crear('td', 'num', `${cifra(f.unidades)} ${f.ume}`), valor, crear('td', 'bj-doc', f.documento), crear('td', 'bj-doc', f.usuario));
  }
  const pie = crear('div', 'bj-paginas');
  const info = crear('span', undefined, `${cifra(paginaDetalle * POR_PAGINA + 1)}–${cifra(Math.min(lista.length, (paginaDetalle + 1) * POR_PAGINA))} de ${cifra(lista.length)}`);
  const flecha = (texto: string, deshabilitada: boolean, ir: () => void, trazo: string) => {
    const b = crear('button', 't1-flecha');
    b.type = 'button';
    b.setAttribute('aria-label', texto);
    b.disabled = deshabilitada;
    b.append(icono(trazo));
    b.addEventListener('click', () => { ir(); pintarDetalle(); });
    return b;
  };
  pie.append(info, flecha('Página anterior', paginaDetalle === 0, () => { paginaDetalle--; }, 'm14.5 6-6 6 6 6'), flecha('Página siguiente', paginaDetalle >= paginas - 1, () => { paginaDetalle++; }, 'm9.5 6 6 6-6 6'));
  const desliza = crear('div', 'bj-detalle-scroll');
  desliza.append(tabla);
  caja.replaceChildren(desliza, pie);
}
buscar.addEventListener('input', () => { paginaDetalle = 0; pintarDetalle(); });

function pintarResumen(r: ResultadoBajas) {
  const partes = [filtro.desde === filtro.hasta ? fecha(filtro.desde) : `Del ${fecha(filtro.desde)} al ${fecha(filtro.hasta)}`];
  partes.push(r.tarjetas.movimientos ? `${plural(r.tarjetas.movimientos, 'movimiento', 'movimientos')} · ${millones(r.tarjetas.valor)} netos` : 'sin bajas');
  resumenTexto.dataset.tipo = '';
  resumenTexto.textContent = partes.join(' · ');
}

function pintar() {
  if (!filas) return;
  const f: FiltrosBajas = { desde: filtro.desde, hasta: filtro.hasta, cds: filtro.cds, motivos: filtro.motivos };
  resultado = calcularBajas(filas, f);
  pintarResumen(resultado);
  pintarTarjetas(resultado);
  pintarGraficos(resultado);
  pintarMapa(resultado);
  paginaDetalle = 0;
  pintarDetalle();
}
let temporizador = 0;
function recalcular(espera = 120) {
  document.body.classList.add('t1-calculando');
  clearTimeout(temporizador);
  temporizador = window.setTimeout(() => {
    try { pintar(); } finally { document.body.classList.remove('t1-calculando'); }
  }, espera);
}

// ---------- Filtros ----------

type Lista = 'cds' | 'motivos';
/** Lista desplegable con casillas (CD y motivo). */
function crearMulti(id: string, etiquetaId: string, cual: Lista, todosTexto: string) {
  const raiz = porId(id);
  const boton = crear('button', 't1-multi-boton');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');
  const valor = crear('span', 't1-multi-valor', 'Todos');
  valor.id = `${id}Valor`;
  boton.setAttribute('aria-labelledby', `${etiquetaId} ${valor.id}`);
  boton.append(valor, icono('m6 9 6 6 6-6'));
  const panel = crear('div', 't1-multi-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-labelledby', etiquetaId);
  const todos = crear('button', 't1-multi-todos', todosTexto);
  todos.type = 'button';
  const lista = crear('div', 't1-multi-lista');
  panel.append(todos, lista);
  raiz.append(boton, panel);
  const abrir = (si: boolean) => {
    panel.hidden = !si;
    boton.setAttribute('aria-expanded', String(si));
    if (si) panel.querySelector<HTMLElement>('input, button')?.focus();
  };
  boton.addEventListener('click', () => abrir(panel.hidden !== false));
  todos.addEventListener('click', () => { filtro[cual] = []; pintarFiltros(); recalcular(); });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { abrir(false); boton.focus(); } });
  lista.addEventListener('change', e => {
    const casilla = e.target as HTMLInputElement;
    const elegidos = filtro[cual];
    const i = elegidos.indexOf(casilla.value);
    if (casilla.checked && i < 0) elegidos.push(casilla.value);
    if (!casilla.checked && i >= 0) elegidos.splice(i, 1);
    elegidos.sort(porTexto);
    pintarFiltros();
    recalcular();
  });
  document.addEventListener('pointerdown', e => { if (!panel.hidden && !raiz.contains(e.target as Node)) abrir(false); });
  return { boton, valor, lista };
}
const multiCds = crearMulti('bjMultiCds', 'bjCdsEt', 'cds', 'Todos (quitar el filtro de CD)');
const multiMotivos = crearMulti('bjMultiMotivos', 'bjMotivosEt', 'motivos', 'Todos (quitar el filtro de motivo)');

function llenarMultis() {
  if (!opciones) return;
  const casilla = (valor: string, texto: string, elegido: boolean, detalle?: string) => {
    const et = crear('label', 't1-casilla');
    const c = crear('input');
    c.type = 'checkbox';
    c.value = valor;
    c.checked = elegido;
    const t = crear('span', undefined, texto);
    if (detalle) t.append(crear('small', undefined, detalle));
    et.append(c, t);
    return et;
  };
  multiCds.lista.classList.toggle('t1-multi-lista-2', opciones.cds.length > 8);
  multiCds.lista.replaceChildren(...opciones.cds.map(cd => casilla(cd, cd, filtro.cds.includes(cd))));
  multiMotivos.lista.replaceChildren(...opciones.motivos.map(m => casilla(m.motivo, m.nombre, filtro.motivos.includes(m.motivo), NOMBRE_GRUPO[m.grupo])));
  const texto = (elegidos: string[], nombre: (v: string) => string) => (!elegidos.length ? 'Todos' : elegidos.length === 1 ? nombre(elegidos[0]) : `${elegidos.length} elegidos`);
  multiCds.valor.textContent = texto(filtro.cds, v => v);
  multiMotivos.valor.textContent = texto(filtro.motivos, nombreMotivo);
  multiCds.boton.classList.toggle('t1-con-valor', filtro.cds.length > 0);
  multiMotivos.boton.classList.toggle('t1-con-valor', filtro.motivos.length > 0);
}

/** Pone o quita un CD o un motivo del filtro (también desde un clic en una barra). */
function alternar(cual: Lista, valor: string) {
  const elegidos = filtro[cual];
  const i = elegidos.indexOf(valor);
  if (i >= 0) elegidos.splice(i, 1); else elegidos.push(valor);
  elegidos.sort(porTexto);
  const nombre = cual === 'cds' ? `CD ${valor}` : `motivo ${nombreMotivo(valor)}`;
  anuncio.textContent = i >= 0 ? `Se quitó el filtro ${nombre}.` : `Filtro aplicado: ${nombre}.`;
  pintarFiltros();
  recalcular();
}

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
  llenarMultis();
  // Filtros aplicados, cada uno con su botón para quitarlo.
  const lista = porId('bjActivos');
  const activos: [Lista, string, string][] = [...filtro.cds.map(v => ['cds', v, `CD: ${v}`] as [Lista, string, string]), ...filtro.motivos.map(v => ['motivos', v, `Motivo: ${nombreMotivo(v)}`] as [Lista, string, string])];
  lista.hidden = !activos.length;
  lista.replaceChildren(...activos.map(([cual, valor, texto]) => {
    const li = crear('li');
    const b = crear('button', 't1-activo');
    b.type = 'button';
    b.setAttribute('aria-label', `Quitar filtro ${texto}`);
    b.append(crear('span', undefined, texto), icono('M7 7l10 10M17 7 7 17'));
    b.addEventListener('click', () => { alternar(cual, valor); porId<HTMLButtonElement>('bjLimpiar').focus(); });
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
  ponerRango(Math.max(opciones.desde, diaDeIso(`${campoMes.value}-01`)), Math.min(opciones.hasta, finDeMes(campoMes.value)));
});
porId('bjLimpiar').addEventListener('click', () => {
  filtro.cds = [];
  filtro.motivos = [];
  rangoInicial();
  rangoPorDefecto = true;
  anuncio.textContent = 'Se quitaron los filtros.';
  pintarFiltros();
  recalcular();
});

// ---------- Carga de datos ----------

function pintarCarga() {
  const c = carga;
  porId('bjHeroDatos').textContent = c
    ? `Datos guardados: ${plural(c.filas, 'movimiento', 'movimientos')} del ${fecha(diaDeIso(c.desde))} al ${fecha(diaDeIso(c.hasta))}${c.cargas ? ` (${plural(c.cargas, 'archivo', 'archivos')})` : ''} · último: ${c.archivo}, subido por ${c.usuario_nombre || 'sin nombre'} el ${formatoMomento.format(new Date(c.creado_en))}`
    : 'Sin datos cargados';
}

/** Copia de los datos en el navegador: se vuelven a descargar solo cuando alguien sube un archivo nuevo. */
const ALMACEN = 'bajas-datos';
async function pedirDatos(): Promise<ColumnasBajas> {
  const ruta = '/api/bajas/datos/bajas';
  const url = `${ruta}?v=${encodeURIComponent(carga?.creado_en ?? '')}`;
  const almacen = 'caches' in window ? await caches.open(ALMACEN).catch(() => null) : null;
  const guardada = await almacen?.match(url).catch(() => undefined);
  if (guardada) {
    try { return await guardada.json() as ColumnasBajas; } catch { /* Copia dañada: se descarga de nuevo. */ }
  }
  const respuesta = await fetch(url);
  if (respuesta.status === 401) { location.replace('/'); throw new Error('La sesión terminó.'); }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    throw new Error(cuerpo.error || 'No se pudieron consultar las bajas.');
  }
  if (almacen) {
    try {
      for (const vieja of await almacen.keys()) if (new URL(vieja.url).pathname === ruta) await almacen.delete(vieja);
      await almacen.put(url, respuesta.clone());
    } catch { /* Sin espacio para la copia: la página funciona igual. */ }
  }
  return respuesta.json() as Promise<ColumnasBajas>;
}

function mostrarVacio(sinDatos: boolean) {
  porId('bjVacio').hidden = !sinDatos;
  tablero.hidden = sinDatos;
  document.querySelector<HTMLElement>('.bj-kpis')!.hidden = sinDatos;
  document.querySelector<HTMLElement>('#bjFiltros .t1-filtros-fila')!.hidden = sinDatos;
}

function cargar(): Promise<void> {
  cargando ??= (async () => {
    document.body.classList.add('t1-cargando');
    try {
      const respuesta = await fetch('/api/bajas/estado');
      if (respuesta.status === 401) { location.replace('/'); return; }
      const estado = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(estado.error || 'No se pudo consultar Bajas.');
      carga = estado.bajas ?? null;
      pintarCarga();
      if (!carga) {
        filas = null;
        mostrarVacio(true);
        resumenTexto.dataset.tipo = '';
        resumenTexto.textContent = 'Aún no hay datos: sube el Excel de bajas de SAP.';
        return;
      }
      resumenTexto.textContent = `Cargando ${plural(carga.filas, 'movimiento', 'movimientos')}…`;
      filas = filasBajas(await pedirDatos());
      opciones = opcionesBajas(filas);
      filtro.cds = filtro.cds.filter(v => opciones!.cds.includes(v));
      filtro.motivos = filtro.motivos.filter(v => opciones!.motivos.some(m => m.motivo === v));
      if (rangoPorDefecto || !filtro.desde) rangoInicial();
      else if (opciones.desde !== null && opciones.hasta !== null) {
        filtro.desde = Math.min(opciones.hasta, Math.max(opciones.desde, filtro.desde));
        filtro.hasta = Math.min(opciones.hasta, Math.max(filtro.desde, filtro.hasta));
      }
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

// Subir el Excel de un mes: se lee en segundo plano (cargas-worker), se sube comprimido y se vuelve a cargar.
const entradaArchivo = porId<HTMLInputElement>('bjArchivo');
const progreso = porId('bjProgreso');
const progresoTexto = porId('bjProgresoTexto');
const botonesSubir = ['bjSubir', 'bjVacioSubir'].map(id => porId<HTMLButtonElement>(id));
let subiendo = false;
function avance(texto: string, tipo: '' | 'ok' | 'error' = '') {
  progreso.hidden = false;
  progreso.dataset.tipo = tipo;
  progresoTexto.textContent = texto;
}
function leerEnSegundoPlano(file: File): Promise<RespuestaWorkerCargas> {
  return new Promise(resolver => {
    const trabajador = new Worker('/js/cargas-worker.js', { type: 'module' });
    trabajador.onmessage = (e: MessageEvent<RespuestaWorkerCargas>) => { trabajador.terminate(); resolver(e.data); };
    trabajador.onerror = () => { trabajador.terminate(); resolver({ error: 'No se pudo leer el archivo. Verifica que sea el Excel de bajas de SAP y vuelve a intentar.' }); };
    trabajador.postMessage({ file, tipo: 'bajas' });
  });
}
async function subir(archivo: File | undefined) {
  if (subiendo || !archivo) return;
  subiendo = true;
  botonesSubir.forEach(b => { b.disabled = true; });
  let listo = '', problema = '';
  try {
    avance(`Leyendo ${archivo.name}…`);
    const lectura = await leerEnSegundoPlano(archivo);
    if (lectura.error || !lectura.gzip) problema = lectura.error ?? 'no se pudo leer.';
    else {
      avance(`Subiendo ${archivo.name} · ${plural(lectura.filas ?? 0, 'movimiento', 'movimientos')}…`);
      const respuesta = await fetch('/api/bajas/cargar/bajas', {
        method: 'POST', body: lectura.gzip,
        headers: { 'Content-Type': 'application/octet-stream', 'x-archivo': encodeURIComponent(archivo.name) },
      });
      if (respuesta.status === 401) { location.replace('/'); return; }
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) problema = cuerpo.error || 'no se pudo guardar.';
      else {
        const omitidas = lectura.omitidas?.length ?? 0;
        listo = `${archivo.name}: ${plural(lectura.filas ?? 0, 'movimiento', 'movimientos')}${lectura.desde != null && lectura.hasta != null ? `, del ${fecha(lectura.desde)} al ${fecha(lectura.hasta)}` : ''}`
          + (omitidas ? ` · ${plural(omitidas, 'fila omitida', 'filas omitidas')} (fila ${lectura.omitidas![0].fila}: ${lectura.omitidas![0].motivo.toLowerCase()})` : '');
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
    const respuesta = await fetch('/api/bajas/estado');
    if (!respuesta.ok) return;
    const estado = await respuesta.json() as { bajas?: Carga | null };
    if ((estado.bajas?.creado_en ?? null) !== (carga?.creado_en ?? null) && !cargando) await cargar();
  } catch { /* Sin conexión: se intenta en la próxima revisión. */ }
}
setInterval(() => void revisarCargasNuevas(), 120_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void revisarCargasNuevas(); });

void cargar();

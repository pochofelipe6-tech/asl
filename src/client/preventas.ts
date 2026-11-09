import * as XLSX from 'xlsx';
import { COLUMNAS_PREVENTAS, metricasPreventa, normalizarPreventa } from '../shared/preventas';
import type { FilaPreventa } from '../shared/preventas';

type Snapshot = { fecha: number; material: string; descripcion: string; cd: string; agotados: number };
type Datos = { lote: { id: string | null; archivo: string }; filas: { id: number; valores: FilaPreventa }[]; snapshot: Snapshot[]; persistido: boolean };
type Vista = 'datos' | 'canal' | 'so';
type Filtros = { fechas: number[]; cds: string[]; canal: string; categoria: string; texto: string };
type Celda = string | number | null;
type Resumen = { cd: string; preventa: number; disponible: number; agotados: number; so: number };
type Bloque = { filas: Resumen[]; total: Resumen };
type FilaMatriz = { cd: string; valores: (number | null)[]; total: number };
// Las 6 tablas de la hoja "Preventa Regional Norte": total por CD, dos matrices CD × canal y una tabla por canal.
type TablaResumen = { tipo: 'total' | 'canal'; fecha: number; canal: string } & Bloque;
type TablaMatriz = { tipo: 'disponible' | 'preventa'; fecha: number; canales: string[]; filas: FilaMatriz[]; totales: number[]; total: number };
type Tabla = TablaResumen | TablaMatriz;
const esMatriz = (t: Tabla): t is TablaMatriz => t.tipo === 'disponible' || t.tipo === 'preventa';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => el<HTMLSelectElement>(id);
const campo = (id: string) => el<HTMLInputElement>(id);
const numero = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const entero = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const porcentaje = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 2 });
const fechaIso = (n: number) => new Date((n - 25569) * 86400000).toISOString().slice(0, 10);
const fechaTexto = (n: number) => fechaIso(n).split('-').reverse().join('/');
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const sinTildes = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
const ordenTexto = (a: string, b: string) => a.localeCompare(b, 'es');
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
// Canales de la hoja Preventa Regional Norte, en su orden. Cualquier otro valor se marca para revisar en origen.
const CANALES = ['TAT', 'KA', 'T4'];
const CALENDARIO = '<svg class="pv-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const TITULOS = { total: 'Preventa total', disponible: 'Preventa disponible por canal', preventa: 'Preventa por canal' } as const;
const MEDIDAS = { disponible: 'HL Disp Prev', preventa: 'HL Preventa' } as const;
const TEXTOS: Record<Vista, { titulo: string; resalte: string; subtitulo: string }> = {
  datos: { titulo: 'Datos de ', resalte: 'preventa', subtitulo: 'Consulta, importa y registra la información base de preventa de tu operación.' },
  canal: { titulo: 'Preventa por ', resalte: 'canal', subtitulo: 'Consulta la preventa por canal y centro de distribución en las fechas de corte de tu operación.' },
  so: { titulo: 'SO · ', resalte: 'Agotados', subtitulo: 'Revisa los agotados por material y centro de distribución en cada corte de tu operación.' },
};

let datos: Datos | null = null;
let vista: Vista = 'canal', pagina = 0, ocupado = false;
// Filtros aplicados; el panel lateral es un borrador hasta pulsar Aplicar.
let aplicados: Filtros = { fechas: [], cds: [], canal: '', categoria: '', texto: '' };
const fechasVista: Partial<Record<Vista, number[]>> = {};
let cabeceras: string[] = [], tabla: Celda[][] = [], totales: Celda[] = [];
let tablasCanal: Tabla[] = [];
let pendiente: { archivo: string; filas: FilaPreventa[]; snapshot: Snapshot[] } | null = null;
let exportarDatos: FilaPreventa[] = [];
// El aviso de canales por revisar se marca para ocultarlo en Preventa por canal, donde ya lo explica la nota de las tablas.
// Indicador de carga en pantalla (el mismo del Índice de frescura), además del aviso de estado.
let cargas = 0;
function mostrarCarga(titulo: string, detalle = 'Un momento, por favor') {
  cargas++; el('loadingTitle').textContent = titulo; el('loadingDetail').textContent = detalle; el('loadingIndicator').hidden = false;
}
function ocultarCarga() { cargas = Math.max(0, cargas - 1); if (!cargas) el('loadingIndicator').hidden = true; }
const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Al cambiar de vista se reinician las animaciones de entrada (portada, filtros, indicadores y tablas).
let vistaAnimada: Vista | null = null;
function reiniciarAnimaciones() {
  const principal = document.querySelector<HTMLElement>('.preventa-app');
  if (!principal) return;
  principal.classList.remove('pv-anim'); void principal.offsetWidth; principal.classList.add('pv-anim');
}
const estado = (mensaje: string, tipo = '') => { const aviso = el('preventaStatus'); aviso.textContent = mensaje; if (tipo) aviso.dataset.tipo = tipo; else delete aviso.dataset.tipo; };

const filasDatos = () => (datos?.filas ?? []).map(f => f.valores);
const unicos = (valores: unknown[]) => [...new Set(valores.map(v => String(v ?? '')).filter(Boolean))].sort(ordenTexto);
function fechasDisponibles(v: Vista) {
  const fechas = new Set(filasDatos().map(f => Number(f[0])));
  if (v === 'so') for (const s of datos?.snapshot ?? []) fechas.add(s.fecha);
  return [...fechas].filter(Number.isFinite).sort((a, b) => a - b);
}
function fechasPorDefecto(v: Vista) {
  if (v === 'so' && datos?.snapshot.length) return [Math.max(...datos.snapshot.map(s => s.fecha))];
  const fechas = fechasDisponibles(v);
  return fechas.length ? [fechas[fechas.length - 1]] : [];
}
function fechasValidas(v: Vista, fechas: number[] | undefined) {
  const disponibles = new Set(fechasDisponibles(v)), validas = (fechas ?? []).filter(f => disponibles.has(f));
  if (!validas.length) return fechasPorDefecto(v);
  return v === 'canal' ? validas : [validas[validas.length - 1]];
}
// Las fechas que solo existen en la hoja SO son cortes históricos sin canal ni categoría.
const esHistorico = (fecha: number) => vista === 'so' && !filasDatos().some(f => Number(f[0]) === fecha);

function opciones(id: string, valores: string[], valor: string) {
  const control = select(id);
  control.replaceChildren(new Option('Todos', ''), ...valores.map(v => new Option(v, v)));
  control.value = valores.includes(valor) ? valor : '';
}
function cdsDisponibles(fecha: number) {
  return esHistorico(fecha) ? unicos((datos?.snapshot ?? []).filter(s => s.fecha === fecha).map(s => s.cd)) : unicos(filasDatos().map(f => f[21]));
}
function filtrarListaCds() {
  const texto = sinTildes(campo('pvCdSearch').value.trim());
  for (const item of el('pvCds').querySelectorAll<HTMLElement>('.pv-check')) item.hidden = !!texto && !(item.dataset.buscar ?? '').includes(texto);
  el('pvCds').scrollTop = 0;
}
function resumenCds() {
  const total = el('pvCds').querySelectorAll('input[name="pvCd"]').length, marcados = el('pvCds').querySelectorAll('input[name="pvCd"]:checked').length;
  el('pvCdHint').textContent = !total ? '' : marcados ? `${marcados} de ${total} CD seleccionados.` : `Sin selección: se incluyen los ${total} CD.`;
}
// Los CD se comparan sin tildes: la hoja SO escribe "La Arenosa" y la hoja Datos "La Árenosa".
const mismaCd = (seleccion: string[]) => { const claves = new Set(seleccion.map(sinTildes)); return (cd: string) => claves.has(sinTildes(cd)); };
const canalesDisponibles = () => unicos(filasDatos().map(f => f[15]));
const categoriasDisponibles = () => unicos(filasDatos().map(f => f[29]));
function dibujarCds(fecha: number, seleccion: string[]) {
  const cds = cdsDisponibles(fecha), marcado = mismaCd(seleccion);
  el('pvCds').innerHTML = cds.length ? cds.map(cd => `<label class="pv-check" data-buscar="${esc(sinTildes(cd))}"><input type="checkbox" name="pvCd" value="${esc(cd)}"${marcado(cd) ? ' checked' : ''}><span>${esc(cd)}</span></label>`).join('') : '<p class="pv-empty-list">Sin centros para esta fecha.</p>';
  filtrarListaCds(); resumenCds();
}
// Filtros que realmente aplican en la vista y la fecha actuales. `aplicados` conserva lo que eligió la persona;
// aquí solo se ajusta a lo que existe (el corte histórico de SO no tiene canal ni categoría), sin borrar la elección.
function efectivos(f: Filtros = aplicados): Filtros {
  const fechas = f.fechas.length ? f.fechas : vista === 'canal' ? fechasDisponibles(vista) : fechasPorDefecto(vista);
  const fecha = fechas[0] ?? NaN, historico = esHistorico(fecha);
  return {
    fechas,
    cds: f.cds.length ? cdsDisponibles(fecha).filter(mismaCd(f.cds)) : [],
    canal: !historico && canalesDisponibles().includes(f.canal) ? f.canal : '',
    categoria: !historico && categoriasDisponibles().includes(f.categoria) ? f.categoria : '',
    texto: f.texto,
  };
}
function estadoHistorico(fecha: number) {
  const historico = esHistorico(fecha), f = efectivos({ ...aplicados, fechas: [fecha] });
  for (const [id, valor] of [['pvCanal', f.canal], ['pvCategoria', f.categoria]] as const) { select(id).disabled = historico; select(id).value = historico ? '' : valor; }
}
function leerBorrador(): Filtros {
  const marcados = (name: string) => [...el('pvFilters').querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(i => i.value);
  return {
    fechas: marcados('pvFecha').map(Number),
    cds: marcados('pvCd'),
    // Con el corte histórico de SO los selects quedan bloqueados: se conserva el canal y la categoría elegidos.
    canal: select('pvCanal').disabled ? aplicados.canal : select('pvCanal').value,
    categoria: select('pvCategoria').disabled ? aplicados.categoria : select('pvCategoria').value,
    texto: campo('pvSearch').value.trim(),
  };
}
const clave = (f: Filtros) => { const e = efectivos(f); return JSON.stringify([[...e.fechas].sort((a, b) => a - b), e.cds.map(sinTildes).sort(), e.canal, e.categoria, e.texto]); };
function marcarPendiente() {
  const hay = !!datos && clave(leerBorrador()) !== clave(aplicados);
  el('pvPending').hidden = !hay; el('applyPvFilters').classList.toggle('pv-pendiente', hay);
}
function sincronizarFiltros() {
  const tipo = vista === 'canal' ? 'checkbox' : 'radio';
  el('pvFechas').innerHTML = fechasDisponibles(vista).map(n => `<label class="pv-check"><input type="${tipo}" name="pvFecha" value="${n}"${aplicados.fechas.includes(n) ? ' checked' : ''}><span>${fechaTexto(n)}</span>${vista === 'so' && esHistorico(n) ? '<small>Hoja SO</small>' : ''}</label>`).join('') || '<p class="pv-empty-list">Sin fechas disponibles.</p>';
  const f = efectivos();
  opciones('pvCanal', canalesDisponibles(), f.canal);
  opciones('pvCategoria', categoriasDisponibles(), f.categoria);
  campo('pvSearch').value = aplicados.texto;
  const fecha = aplicados.fechas[0] ?? NaN;
  dibujarCds(fecha, f.cds);
  estadoHistorico(fecha);
  marcarPendiente();
}
function aplicar() {
  if (!datos) return;
  const borrador = leerBorrador();
  // Sin fechas marcadas en Preventa por canal se muestran todas; en las demás vistas siempre hay una.
  aplicados = { ...borrador, fechas: borrador.fechas.length ? borrador.fechas : vista === 'canal' ? fechasDisponibles(vista) : fechasPorDefecto(vista) };
  fechasVista[vista] = aplicados.fechas; pagina = 0;
  sincronizarFiltros(); render();
}

function filtrar(f: Filtros) {
  const texto = f.texto.toLocaleLowerCase('es');
  return filasDatos().filter(r => f.fechas.includes(Number(r[0])) && (!f.cds.length || f.cds.includes(String(r[21]))) && (!f.canal || String(r[15]) === f.canal) && (!f.categoria || String(r[29] ?? '') === f.categoria) && (!texto || `${r[3]} ${r[4]}`.toLocaleLowerCase('es').includes(texto)));
}
function sumar(filas: FilaPreventa[]) {
  return filas.reduce((a, f) => { const m = metricasPreventa(f); a.preventa += m.preventa; a.disponible += m.disponible; a.agotados += m.agotados; return a; }, { preventa: 0, disponible: 0, agotados: 0 });
}
// Los indicadores cuentan hasta su valor; con "reducir movimiento" se muestran directamente.
const valoresKpi = new Map<string, number>(), turnoKpi = new Map<string, number>();
function kpi(id: string, valor: number | null, formato: (n: number) => string = n => numero.format(n), unidad = 'HL') {
  const nodo = el(id), turno = (turnoKpi.get(id) ?? 0) + 1;
  turnoKpi.set(id, turno); nodo.classList.remove('pv-kpi-texto');
  if (valor === null) { valoresKpi.delete(id); nodo.textContent = '—'; return; }
  const pintar = (n: number) => { nodo.innerHTML = `${formato(n)}${unidad ? `<small>${unidad}</small>` : ''}`; };
  const desde = valoresKpi.get(id) ?? 0;
  valoresKpi.set(id, valor);
  if (reducido() || desde === valor) { pintar(valor); return; }
  const inicio = performance.now(), duracion = 1000;
  const paso = () => {
    if (turnoKpi.get(id) !== turno) return;
    // Se mide con el mismo reloj que el inicio y se limita a 0–1: así nunca se muestra un valor fuera del rango.
    const p = Math.min(1, Math.max(0, (performance.now() - inicio) / duracion));
    pintar(p < 1 ? desde + (valor - desde) * (1 - Math.pow(1 - p, 3)) : valor);
    if (p < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
  // Respaldo: si el navegador pausa las animaciones (pestaña en segundo plano), el valor exacto queda igual al terminar.
  setTimeout(() => { if (turnoKpi.get(id) === turno) { turnoKpi.set(id, turno + 1); pintar(valor); } }, duracion + 150);
}
function kpiTexto(id: string, texto: string, detalle: string) {
  turnoKpi.set(id, (turnoKpi.get(id) ?? 0) + 1); valoresKpi.delete(id);
  el(id).classList.add('pv-kpi-texto');
  el(id).innerHTML = `${esc(texto)}${detalle ? `<small>${esc(detalle)}</small>` : ''}`;
}
// Solo en SO · Agotados: la hoja SO no trae pedidos ni inventario, así que en lugar de los indicadores de preventa
// (que quedarían en "—") se muestran indicadores de agotados, con datos en los dos cortes. Las demás vistas no cambian.
const ETIQUETAS_SO = ['Agotados totales', 'Materiales con agotados', 'CD con agotados', 'CD más afectado'];
const ICONOS_SO = [
  '<svg class="pv-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/></svg>',
  '<svg class="pv-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z"/><path d="m3.5 7.25 8.5 4.75 8.5-4.75M12 12v9.5"/></svg>',
  '<svg class="pv-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 11.5-7 11.5S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  '<svg class="pv-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 6 6 4-4 8 8"/><path d="M21 11v6h-6"/></svg>',
];
const tarjetasKpi = [...document.querySelectorAll<HTMLElement>('.pv-kpi')].map(tarjeta => {
  const etiqueta = tarjeta.querySelector<HTMLElement>('div > span')!, icono = tarjeta.querySelector<HTMLElement>('.pv-kpi-icon')!;
  return { etiqueta, icono, base: { etiqueta: etiqueta.textContent ?? '', icono: icono.innerHTML } };
});
function configurarKpis() {
  const so = vista === 'so';
  tarjetasKpi.forEach((t, i) => {
    const etiqueta = so ? ETIQUETAS_SO[i] : t.base.etiqueta;
    if (t.etiqueta.textContent !== etiqueta) { t.etiqueta.textContent = etiqueta; t.icono.innerHTML = so ? ICONOS_SO[i] : t.base.icono; }
  });
}
// Agrupa por CD con TODOS los centros que tienen registros, ordenados por participación SO como en el Excel.
function resumir(filas: FilaPreventa[]): Bloque {
  const grupos = new Map<string, Resumen>();
  for (const f of filas) {
    const cd = String(f[21]), m = metricasPreventa(f), g = grupos.get(cd) ?? { cd, preventa: 0, disponible: 0, agotados: 0, so: 0 };
    g.preventa += m.preventa; g.disponible += m.disponible; g.agotados += m.agotados; grupos.set(cd, g);
  }
  const lista = [...grupos.values()].map(g => ({ ...g, so: g.preventa ? g.agotados / g.preventa : 0 }))
    .sort((a, b) => b.so - a.so || b.agotados - a.agotados || b.preventa - a.preventa || ordenTexto(a.cd, b.cd));
  const total = lista.reduce((t, g) => ({ ...t, preventa: t.preventa + g.preventa, disponible: t.disponible + g.disponible, agotados: t.agotados + g.agotados }), { cd: 'Total general', preventa: 0, disponible: 0, agotados: 0, so: 0 });
  total.so = total.preventa ? total.agotados / total.preventa : 0;
  return { filas: lista, total };
}
// Matriz CD × canal (columnas TAT, KA, T4 y Total general), ordenada por el total como la tabla dinámica.
function matriz(filas: FilaPreventa[], canales: string[], medida: (m: ReturnType<typeof metricasPreventa>) => number): Omit<TablaMatriz, 'tipo' | 'fecha'> {
  const porCd = new Map<string, FilaMatriz>();
  for (const f of filas) {
    const i = canales.indexOf(String(f[15]));
    if (i < 0) continue;
    const cd = String(f[21]), valor = medida(metricasPreventa(f)), g = porCd.get(cd) ?? { cd, valores: canales.map((): number | null => null), total: 0 };
    g.valores[i] = (g.valores[i] ?? 0) + valor; g.total += valor; porCd.set(cd, g);
  }
  const lista = [...porCd.values()].sort((a, b) => b.total - a.total || ordenTexto(a.cd, b.cd));
  const totales = canales.map((_, i) => lista.reduce((s, g) => s + (g.valores[i] ?? 0), 0));
  return { canales, filas: lista, totales, total: lista.reduce((s, g) => s + g.total, 0) };
}
function construirTablas(filas: FilaPreventa[], fechas: number[]) {
  const tablas: Tabla[] = [];
  for (const fecha of [...fechas].sort((a, b) => a - b)) {
    const delCorte = filas.filter(f => Number(f[0]) === fecha);
    if (!delCorte.length) continue;
    tablas.push({ tipo: 'total', fecha, canal: '', ...resumir(delCorte) });
    // Como en el Excel, las matrices y las tablas por canal solo usan TAT, KA y T4; los demás canales se suman en el total.
    const canales = CANALES.filter(c => delCorte.some(f => String(f[15]) === c));
    if (!canales.length) continue;
    tablas.push({ tipo: 'disponible', fecha, ...matriz(delCorte, canales, m => m.disponible) });
    tablas.push({ tipo: 'preventa', fecha, ...matriz(delCorte, canales, m => m.preventa) });
    for (const canal of canales) tablas.push({ tipo: 'canal', fecha, canal, ...resumir(delCorte.filter(f => String(f[15]) === canal)) });
  }
  return tablas;
}
const celdaHl = (v: number) => Math.abs(v) < 1e-9 ? '-' : entero.format(Math.round(v) === 0 ? 0 : v);
const celdaSo = (v: number) => `${entero.format(v * 100)}%`;
// Semáforo del % de participación SO como el formato condicional del Excel: verde (mínimo), amarillo (mediana), rojo (máximo).
const VERDE = [61, 184, 120], AMARILLO = [242, 201, 76], ROJO = [239, 68, 68];
// Colores por defecto de la escala de tres colores de Excel, para la imagen exportada.
const COLORES_EXCEL: [number[], number[], number[]] = [[99, 190, 123], [255, 235, 132], [248, 105, 107]];
const mezcla = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
function escalaSo(valores: number[], [bajo, medio, alto] = [VERDE, AMARILLO, ROJO]) {
  const orden = [...valores].sort((a, b) => a - b), n = orden.length;
  const min = orden[0] ?? 0, max = orden[n - 1] ?? 0, mediana = n ? (n % 2 ? orden[(n - 1) / 2] : (orden[n / 2 - 1] + orden[n / 2]) / 2) : 0;
  return (v: number) => max - min < 1e-12 ? (v > 0 ? medio : bajo) : v >= max ? alto : v <= min ? bajo
    : v <= mediana ? mezcla(bajo, medio, (v - min) / (mediana - min)) : mezcla(medio, alto, (v - mediana) / (max - mediana));
}
const encabezadoTarjeta = (t: Tabla) => `<header class="pv-card-head">${t.tipo === 'canal' ? `<span class="pv-pill">${esc(t.canal)}</span>` : `<span class="pv-card-title">${TITULOS[t.tipo]}</span>`}<span class="pv-card-count">${plural(t.filas.length, 'CD', 'CD')}</span><span class="pv-card-date">${CALENDARIO}${fechaTexto(t.fecha)}</span></header>`;
function tarjeta(t: Tabla, indice = 0) {
  const orden = ` style="--c:${indice};--n:${t.filas.length}"`;
  const corte = fechaTexto(t.fecha);
  if (esMatriz(t)) {
    // En el Excel la matriz de disponible muestra "-" donde no hay canal y la de preventa deja la celda vacía.
    const vacio = t.tipo === 'disponible' ? '-' : '';
    const fila = (cd: string, valores: (number | null)[], total: number, pie = false, r = 0) => `<tr${pie ? ' class="pv-total"' : ` style="--i:${r}"`}><th scope="row">${esc(cd)}</th>${valores.map(v => v === null ? `<td>${vacio}</td>` : `<td title="${numero.format(v)} HL">${celdaHl(v)}</td>`).join('')}<td class="pv-col-total" title="${numero.format(total)} HL">${celdaHl(total)}</td></tr>`;
    return `<article class="pv-card pv-card-matriz"${orden}>${encabezadoTarjeta(t)}<div class="pv-card-scroll"><table class="pv-mini"><caption class="pv-sr">${TITULOS[t.tipo]} (${MEDIDAS[t.tipo]}) por centro de distribución, corte ${corte}</caption><thead><tr><th scope="col">CD</th>${t.canales.map(c => `<th scope="col">${esc(c)}</th>`).join('')}<th scope="col">Total general</th></tr></thead><tbody>${t.filas.map((g, r) => fila(g.cd, g.valores, g.total, false, r)).join('')}</tbody><tfoot>${fila('Total general', t.totales, t.total, true)}</tfoot></table></div></article>`;
  }
  const color = escalaSo(t.filas.map(g => g.so));
  const fila = (g: Resumen, pie = false, r = 0) => `<tr${pie ? ' class="pv-total"' : ` style="--i:${r}"`}><th scope="row">${esc(g.cd)}</th>${[g.preventa, g.disponible].map(v => `<td title="${numero.format(v)} HL">${celdaHl(v)}</td>`).join('')}<td class="pv-ago" title="${numero.format(g.agotados)} HL">${celdaHl(g.agotados)}</td><td class="pv-so"${pie ? '' : ` style="--so:${color(g.so).join(' ')}"`} title="${porcentaje.format(g.so)}">${celdaSo(g.so)}</td></tr>`;
  const nombre = t.tipo === 'canal' ? `Preventa del canal ${esc(t.canal)}` : TITULOS.total;
  return `<article class="pv-card"${orden}>${encabezadoTarjeta(t)}<div class="pv-card-scroll"><table class="pv-mini"><caption class="pv-sr">${nombre} por centro de distribución, corte ${corte}</caption><thead><tr><th scope="col">CD</th><th scope="col">HL Preventa</th><th scope="col">HL Disp Prev</th><th scope="col">Agotados</th><th scope="col">% Participación SO</th></tr></thead><tbody>${t.filas.map((g, r) => fila(g, false, r)).join('')}</tbody><tfoot>${fila(t.total, true)}</tfoot></table></div></article>`;
}
function renderCanal(filas: FilaPreventa[]) {
  tablasCanal = construirTablas(filas, aplicados.fechas);
  const porFecha = new Map<number, Tabla[]>();
  for (const t of tablasCanal) porFecha.set(t.fecha, [...(porFecha.get(t.fecha) ?? []), t]);
  el('pvChannelTables').innerHTML = tablasCanal.length
    ? [...porFecha.values()].map(grupo => `<div class="pv-channel-grid">${grupo.map((t, i) => tarjeta(t, i)).join('')}</div>`).join('')
    : '<p class="pv-empty">No hay registros para los filtros seleccionados.</p>';
  const n = tablasCanal.length;
  el('pvTablesCount').textContent = !n ? 'Sin tablas' : `${plural(n, 'tabla', 'tablas')}${porFecha.size > 1 ? ` · ${plural(porFecha.size, 'fecha', 'fechas')}` : ''}`;
  const cortes = aplicados.fechas.map(fechaTexto).join(', '), filtro = efectivos();
  el('canalHelp').textContent = `Hoja Datos · ${aplicados.fechas.length === 1 ? 'corte' : 'cortes'} ${cortes} · ${filtro.cds.length ? plural(filtro.cds.length, 'CD seleccionado', 'CD seleccionados') : 'todos los CD'}${filtro.canal ? ` · canal ${filtro.canal}` : ''}${filtro.categoria ? ` · categoría ${filtro.categoria}` : ''}${filtro.texto ? ` · material «${filtro.texto}»` : ''} · valores en HL. Tablas ordenadas por % de participación SO; las matrices por canal, por total general.`;
  // Los canales fuera de TAT, KA y T4 (p. ej. "x`º") solo se suman en Preventa total, igual que en el Excel.
  const otros = filas.filter(f => !CANALES.includes(String(f[15])));
  el('canalNota').hidden = !otros.length;
  el('canalNota').textContent = otros.length ? `El canal ${unicos(otros.map(f => f[15])).join(', ')} (${plural(otros.length, 'registro', 'registros')}, ${numero.format(sumar(otros).preventa)} HL) se suma en Preventa total y en los indicadores, pero no tiene columna en las matrices ni tabla propia, igual que en el Excel. Revísalo en el archivo de origen.` : '';
  el<HTMLButtonElement>('exportCanal').disabled = !n;
  el<HTMLButtonElement>('exportImagen').disabled = !n;
}
function render() {
  if (!datos) return;
  const fecha = aplicados.fechas[0] ?? NaN, historico = vista === 'so' && esHistorico(fecha);
  const f = efectivos(), filas = filtrar(f);
  exportarDatos = filas;
  const texto = f.texto.toLocaleLowerCase('es');
  const snapshot = historico ? datos.snapshot.filter(s => s.fecha === fecha && (!f.cds.length || f.cds.includes(s.cd)) && (!texto || `${s.material} ${s.descripcion}`.toLocaleLowerCase('es').includes(texto))) : [];
  if (vistaAnimada !== vista) {
    if (vistaAnimada !== null) { valoresKpi.clear(); reiniciarAnimaciones(); }
    vistaAnimada = vista;
  }
  const metricas = sumar(filas);
  configurarKpis();
  // En SO · Agotados los indicadores se calculan más abajo, con la misma fuente que la tabla de agotados.
  if (vista !== 'so') {
    kpi('kpiPreventa', metricas.preventa);
    kpi('kpiDisponible', metricas.disponible);
    kpi('kpiAgotados', metricas.agotados);
    kpi('kpiSo', metricas.preventa ? metricas.agotados / metricas.preventa : null, n => porcentaje.format(n), '');
  }
  const varias = vista === 'canal' && aplicados.fechas.length > 1;
  el('kpiNote').hidden = !varias; el('kpiNote').textContent = varias ? `Indicadores acumulados de ${aplicados.fechas.length} fechas de corte.` : '';
  const textos = TEXTOS[vista];
  // El título solo se reemplaza al cambiar de vista; así la palabra resaltada no parpadea al aplicar filtros.
  if (el('viewTitle').textContent !== textos.titulo + textos.resalte) {
    const resalte = document.createElement('em');
    resalte.textContent = textos.resalte;
    el('viewTitle').replaceChildren(textos.titulo, resalte);
  }
  el('viewSubtitle').textContent = textos.subtitulo;
  document.title = `${textos.titulo}${textos.resalte} · Bavaria`;
  document.body.dataset.vista = vista;
  el('datosActions').hidden = vista !== 'datos'; el('canalView').hidden = vista !== 'canal'; el('tableView').hidden = vista === 'canal';
  el('formulaNote').textContent = historico ? 'Corte conservado de la hoja SO del Excel. Solo contiene agotados por material y CD (sin canal ni categoría); por eso esos filtros no aplican a esta fecha.' :'Fórmulas del Excel: total disponible = stock + planta + tránsito − entregas pendientes. Preventa HL = pedidos × factor × HL. Agotados = máximo(preventa − inventario, 0). Preventa disponible = preventa − agotados. Se calcula por registro antes de consolidar; no se compensan faltantes entre materiales o canales.';
  if (vista === 'canal') { renderCanal(filas); return; }
  el('tableHelp').textContent = historico ? `Hoja SO · corte ${fechaTexto(fecha)} · valores en HL.` : `Hoja Datos · corte ${fechaTexto(fecha)} · valores en HL. Los filtros se aplican a toda la vista.`;
  if (vista === 'datos') {
    cabeceras = ['Fecha', 'Centro', 'CD', 'Material', 'Descripción', 'Canal', 'Categoría', 'Stock', 'Planta', 'Tránsito', 'Entrega pendiente', 'Pedidos', 'Factor', 'HL/unidad', 'Preventa HL', 'Inventario HL', 'Disponible HL', 'Agotados HL'];
    tabla = filas.map(f => [fechaTexto(Number(f[0])), f[2], f[21], f[3], f[4], f[15], f[29], f[7], f[8], f[9], f[10], f[13], f[16], f[17], f[18], f[19], metricasPreventa(f).disponible, f[20]]);
    totales = []; el('pvTableTitle').textContent = 'Registros guardados · hoja Datos';
  } else {
    const fuente = historico ? snapshot : filas.map(f => ({ material: String(f[3]), descripcion: String(f[4]), cd: String(f[21]), agotados: Number(f[20]) }));
    const cds = [...new Set(fuente.map(f => f.cd))].sort(ordenTexto);
    const grupos = new Map<string, { descripcion: string; valores: Map<string, number> }>();
    for (const f of fuente) {
      let grupo = grupos.get(f.material);
      if (!grupo) { grupo = { descripcion: f.descripcion, valores: new Map() }; grupos.set(f.material, grupo); }
      grupo.valores.set(f.cd, (grupo.valores.get(f.cd) ?? 0) + f.agotados);
    }
    cabeceras = ['Material', 'Descripción', ...cds, 'Total agotados HL'];
    tabla = [...grupos].map(([material, g]) => { const v = cds.map(c => g.valores.get(c) ?? 0); return [material, g.descripcion, ...v, v.reduce((a, b) => a + b, 0)]; }).filter(r => Number(r.at(-1)) > 0).sort((a, b) => Number(b.at(-1)) - Number(a.at(-1)));
    totales = ['Total filtrado', '', ...cds.map((_, c) => tabla.reduce((s, r) => s + Number(r[c + 2]), 0)), tabla.reduce((s, r) => s + Number(r.at(-1)), 0)];
    el('pvTableTitle').textContent = 'Agotados Regional Norte · material × CD';
    // Indicadores de SO, con la misma fuente y filtros que la tabla (hoja SO o corte calculado desde Datos).
    const porCd = new Map<string, number>();
    for (const f of fuente) porCd.set(f.cd, (porCd.get(f.cd) ?? 0) + f.agotados);
    const totalAgotados = [...porCd.values()].reduce((a, b) => a + b, 0), peor = [...porCd].sort((a, b) => b[1] - a[1])[0];
    kpi('kpiPreventa', totalAgotados);
    kpi('kpiDisponible', tabla.length, n => entero.format(n), tabla.length === 1 ? 'material' : 'materiales');
    kpi('kpiAgotados', [...porCd.values()].filter(v => v > 0.0005).length, n => entero.format(n), `de ${porCd.size} CD`);
    if (peor && peor[1] > 0.0005) kpiTexto('kpiSo', peor[0], `${numero.format(peor[1])} HL · ${porcentaje.format(peor[1] / totalAgotados)}`);
    else kpi('kpiSo', null);
  }
  dibujarTabla();
}
// Tabla de Datos y SO: un número fijo de registros por página y flechas para ver los demás, sin desplazamiento.
const POR_PAGINA = 15;
const decimales5 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 5 });
function dibujarTabla() {
  const paginas = Math.max(1, Math.ceil(tabla.length / POR_PAGINA)); pagina = Math.min(pagina, paginas - 1);
  // Columnas de texto a la izquierda y numéricas a la derecha; HL/unidad necesita más decimales (p. ej. 0,0033).
  const esTexto = cabeceras.map((_, i) => tabla.some(r => typeof r[i] === 'string'));
  const clases = (i: number, v: Celda) => [esTexto[i] ? 'txt' : '', cabeceras[i] === 'Descripción' ? 'pv-desc' : '', cabeceras[i].includes('Agotados') && Number(v) > 0 ? 'shortage' : ''].filter(Boolean).join(' ');
  const textoCelda = (v: Celda, i: number) => typeof v === 'number' ? (cabeceras[i] === 'HL/unidad' ? decimales5 : numero).format(v) : String(v ?? '');
  const celda = (v: Celda, i: number) => esc(textoCelda(v, i));
  // Ancho de cada columna calculado con TODOS los registros (no solo la página visible): al pasar de página con
  // las flechas la tabla no cambia de tamaño ni aparece desplazamiento en unas páginas sí y en otras no.
  const anchos = cabeceras.map((c, i) => {
    let n = Math.max(...c.split(' ').map(p => p.length));
    for (const r of [...tabla, ...(totales.length ? [totales] : [])]) n = Math.max(n, textoCelda(r[i], i).length);
    return c === 'Descripción' ? Math.min(n, 30) : n;
  });
  const fila = (r: Celda[], k = -1) => `<tr${k >= 0 ? ` style="--i:${k}"` : ''}>` + r.map((v, i) => { const c = clases(i, v); return `<td${c ? ` class="${c}"` : ''}${cabeceras[i] === 'Descripción' && v ? ` title="${esc(v)}"` : ''}>${celda(v, i)}</td>`; }).join('') + '</tr>';
  const desde = pagina * POR_PAGINA, hasta = Math.min(desde + POR_PAGINA, tabla.length);
  el('pvTable').innerHTML = `<colgroup>${anchos.map(n => `<col style="width:${n + 1}ch">`).join('')}</colgroup><thead><tr>${cabeceras.map((c, i) => `<th scope="col"${esTexto[i] ? ' class="txt"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${tabla.length ? tabla.slice(desde, hasta).map((r, k) => fila(r, k)).join('') : `<tr><td class="txt" colspan="${cabeceras.length}">No hay registros para los filtros seleccionados.</td></tr>`}</tbody>${totales.length ? `<tfoot>${fila(totales)}</tfoot>` : ''}`;
  const nombre = vista === 'datos' ? 'registros' : 'materiales con agotados';
  el('pvCount').textContent = tabla.length ? `Mostrando ${desde + 1}–${hasta} de ${tabla.length.toLocaleString('es-CO')} ${nombre}` : `0 ${nombre}`;
  el('pvPage').textContent = `Página ${pagina + 1} de ${paginas}`;
  el<HTMLButtonElement>('pvPrevious').disabled = pagina === 0;
  el<HTMLButtonElement>('pvNext').disabled = pagina + 1 >= paginas;
  actualizarColumnas();
}
async function cargar() {
  el<HTMLButtonElement>('refreshData').disabled = true;
  estado('Consultando datos…');
  mostrarCarga('Consultando datos de preventa'); document.body.classList.add('pv-cargando');
  try {
    const res = await fetch('/api/preventas/datos');
    if (res.status === 401) { location.replace('/'); return; }
    const body = await res.json(); if (!res.ok) throw new Error(body.error);
    datos = body;
    el('sourceInfo').textContent = `${datos!.lote.archivo} · ${datos!.filas.length} registros · ${datos!.persistido ? 'Guardado en Supabase' : 'Vista inicial del Excel'}`;
    el('saveNotice').hidden = datos!.persistido;
    el('saveNotice').textContent = 'Estás viendo los datos del Excel entregado. Para habilitar el guardado permanente, ejecuta los dos archivos SQL de Preventas en Supabase. Los datos de esta vista todavía no están guardados allí.';
    const filas = filasDatos();
    for (const [id, c] of [['centrosList', 2], ['cdsList', 21], ['materialesList', 3], ['canalesList', 15], ['categoriasList', 29]] as const) {
      el(id).innerHTML = unicos(filas.map(f => f[c])).map(v => `<option value="${esc(v)}"></option>`).join('');
    }
    aplicados = { ...aplicados, fechas: fechasValidas(vista, aplicados.fechas), canal: canalesDisponibles().includes(aplicados.canal) ? aplicados.canal : '', categoria: categoriasDisponibles().includes(aplicados.categoria) ? aplicados.categoria : '' };
    fechasVista[vista] = aplicados.fechas;
    sincronizarFiltros(); render();
    const raros = [...new Set(filas.map(f => String(f[15])))].filter(c => !CANALES.includes(c));
    estado(raros.length ? `Revisar en origen: canal ${raros.join(', ')}. Se conserva el valor del Excel.` : '', raros.length ? 'origen' : '');
  } catch (error) { estado((error as Error).message || 'No se pudo consultar la información.'); }
  finally { el<HTMLButtonElement>('refreshData').disabled = false; ocultarCarga(); document.body.classList.remove('pv-cargando'); }
}
for (const boton of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) boton.addEventListener('click', () => {
  const destino = boton.dataset.view as Vista;
  if (destino === vista) return;
  fechasVista[vista] = aplicados.fechas;
  vista = destino; pagina = 0;
  for (const b of document.querySelectorAll<HTMLElement>('button[data-view]')) { const activa = b === boton; b.classList.toggle('active', activa); if (activa) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  if (!datos) return;
  aplicados = { ...aplicados, fechas: fechasValidas(vista, fechasVista[vista]) };
  sincronizarFiltros(); render();
});
// Sin barras de desplazamiento: las listas de fechas y CD y las columnas de la tabla se recorren con flechas,
// igual que en el Índice de frescura. La rueda del mouse y el teclado siguen funcionando.
const movimiento = (): ScrollBehavior => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
for (const contenedor of document.querySelectorAll<HTMLElement>('.pv-lista')) {
  const lista = contenedor.querySelector<HTMLElement>('.pv-scroll-list')!;
  const [arriba, abajo] = contenedor.querySelectorAll<HTMLButtonElement>('.pv-flecha');
  const actualizar = () => {
    const maximo = lista.scrollHeight - lista.clientHeight;
    contenedor.classList.toggle('con-flechas', contenedor.dataset.flechas === 'siempre' || maximo > 1);
    arriba.disabled = lista.scrollTop <= 1; abajo.disabled = lista.scrollTop >= maximo - 1;
  };
  const mover = (sentido: number) => lista.scrollBy({ top: sentido * Math.max(30, lista.clientHeight - 30), behavior: movimiento() });
  arriba.addEventListener('click', () => mover(-1)); abajo.addEventListener('click', () => mover(1));
  lista.addEventListener('scroll', actualizar);
  new ResizeObserver(actualizar).observe(lista);
  new MutationObserver(actualizar).observe(lista, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  actualizar();
}
const scrollTabla = document.querySelector<HTMLElement>('#tableView .pv-scroll')!;
function actualizarColumnas() {
  const maximo = scrollTabla.scrollWidth - scrollTabla.clientWidth;
  el('pvColumnas').hidden = maximo <= 1;
  el<HTMLButtonElement>('colAnterior').disabled = scrollTabla.scrollLeft <= 1;
  el<HTMLButtonElement>('colSiguiente').disabled = scrollTabla.scrollLeft >= maximo - 1;
}
el('colAnterior').addEventListener('click', () => scrollTabla.scrollBy({ left: -300, behavior: movimiento() }));
el('colSiguiente').addEventListener('click', () => scrollTabla.scrollBy({ left: 300, behavior: movimiento() }));
scrollTabla.addEventListener('scroll', actualizarColumnas);
const observadorTabla = new ResizeObserver(actualizarColumnas);
observadorTabla.observe(scrollTabla); observadorTabla.observe(el('pvTable'));
addEventListener('resize', actualizarColumnas);
const formFiltros = el<HTMLFormElement>('pvFilters');
formFiltros.addEventListener('submit', event => { event.preventDefault(); aplicar(); });
formFiltros.addEventListener('change', event => {
  const objetivo = event.target as HTMLInputElement;
  if (objetivo.id === 'pvCdSearch') return;
  if (objetivo.name === 'pvFecha' && vista === 'so') { const borrador = leerBorrador(), fecha = borrador.fechas[0] ?? NaN; dibujarCds(fecha, borrador.cds); estadoHistorico(fecha); }
  if (objetivo.name === 'pvCd') resumenCds();
  marcarPendiente();
});
formFiltros.addEventListener('input', event => {
  const objetivo = event.target as HTMLInputElement;
  if (objetivo.id === 'pvCdSearch') filtrarListaCds(); else if (objetivo.id === 'pvSearch') marcarPendiente();
});
// Enter en el buscador de CD solo filtra la lista; no aplica los filtros.
campo('pvCdSearch').addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
el('clearPvFilters').addEventListener('click', () => {
  if (!datos) return;
  aplicados = { fechas: fechasPorDefecto(vista), cds: [], canal: '', categoria: '', texto: '' };
  fechasVista[vista] = aplicados.fechas; campo('pvCdSearch').value = ''; pagina = 0;
  sincronizarFiltros(); render();
});
el('pvPrevious').addEventListener('click', () => { pagina--; dibujarTabla(); });
el('pvNext').addEventListener('click', () => { pagina++; dibujarTabla(); });
el('refreshData').addEventListener('click', () => { if (!ocupado) void cargar(); });
function exportar() {
  if (!datos) return;
  const libro = XLSX.utils.book_new();
  if (vista === 'canal') {
    // Las mismas 6 tablas por corte, una debajo de otra, con valores exactos y formato numérico.
    const filas: Celda[][] = [], formatos: [number, number, string][] = [];
    const agregar = (fila: Celda[], formato?: (c: number) => string) => {
      if (formato) fila.forEach((v, c) => { if (typeof v === 'number') formatos.push([filas.length, c, formato(c)]); });
      filas.push(fila);
    };
    for (const t of tablasCanal) {
      agregar([`${t.tipo === 'canal' ? `Canal ${t.canal}` : TITULOS[t.tipo]} · corte ${fechaTexto(t.fecha)}`]);
      if (esMatriz(t)) {
        agregar([`CD (${MEDIDAS[t.tipo]})`, ...t.canales, 'Total general']);
        for (const g of t.filas) agregar([g.cd, ...g.valores, g.total], () => '#,##0.00');
        agregar(['Total general', ...t.totales, t.total], () => '#,##0.00');
      } else {
        agregar(['CD', 'HL Preventa', 'HL Disp Prev', 'Agotados', '% Participación SO']);
        for (const g of [...t.filas, t.total]) agregar([g.cd, g.preventa, g.disponible, g.agotados, g.so], c => c === 4 ? '0.0%' : '#,##0.00');
      }
      agregar([]);
    }
    const hoja = XLSX.utils.aoa_to_sheet(filas.length ? filas : [['No hay registros para los filtros seleccionados.']]);
    for (const [r, c, z] of formatos) { const celda = hoja[XLSX.utils.encode_cell({ r, c })]; if (celda) celda.z = z; }
    hoja['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(libro, hoja, 'Preventa por canal');
  } else XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([cabeceras, ...tabla, ...(totales.length ? [totales] : [])]), 'Reporte');
  if (exportarDatos.length) XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([COLUMNAS_PREVENTAS, ...exportarDatos]), 'Datos');
  const fechas = [...aplicados.fechas].sort((a, b) => a - b).map(fechaIso);
  XLSX.writeFile(libro, `Preventas_${vista}_${fechas.length > 1 ? `${fechas[0]}_a_${fechas[fechas.length - 1]}` : fechas[0] ?? 'sin-fecha'}.xlsx`);
}
// Imagen JPG de las 6 tablas, dibujada con los datos (no es una captura de pantalla): sale completa, con todos
// los CD y en alta resolución, con el estilo de la hoja "Preventa Regional Norte" del Excel.
const FUENTE = 'Calibri, "Segoe UI", Arial, sans-serif';
const TITULOS_EXCEL = { total: 'Preventa Total', disponible: 'Preventa Disponible por Canal', preventa: 'Preventa por Canal' } as const;
const IMG = { margen: 32, ancho: 480, separacionX: 26, separacionY: 30, encabezado: 96, titulo: 30, cabecera: 26, fila: 22, escala: 2 };
const altoTablaImagen = (t: Tabla) => IMG.titulo + IMG.cabecera + (t.filas.length + 1) * IMG.fila;
function escribir(ctx: CanvasRenderingContext2D, texto: string, x: number, y: number, ancho: number, alinear: 'left' | 'right' | 'center', tamano: number, estilo = '400', color = '#1f1f1f') {
  let t = tamano;
  ctx.font = `${estilo} ${t}px ${FUENTE}`;
  while (t > 8 && ctx.measureText(texto).width > ancho) { t -= .5; ctx.font = `${estilo} ${t}px ${FUENTE}`; }
  ctx.fillStyle = color; ctx.textAlign = alinear; ctx.textBaseline = 'middle';
  ctx.fillText(texto, alinear === 'left' ? x : alinear === 'right' ? x + ancho : x + ancho / 2, y);
}
function linea(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, grosor = 1, punteada = false) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = grosor; ctx.setLineDash(punteada ? [1.5, 2] : []);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
function dibujarTablaImagen(ctx: CanvasRenderingContext2D, t: Tabla, x: number, y: number) {
  const { ancho, titulo, cabecera, fila } = IMG, relleno = 6;
  const columnas = esMatriz(t) ? ['CD', ...t.canales, 'Total general'] : ['CD', 'HL Preventa', 'HL Disp Prev', 'Agotados', '% Participación SO'];
  const resto = (ancho - 128 - 112) / Math.max(1, columnas.length - 2);
  const anchos = columnas.map((_, i) => i === 0 ? 128 : i === columnas.length - 1 ? 112 : resto);
  const xs = anchos.map((_, i) => x + anchos.slice(0, i).reduce((a, b) => a + b, 0));
  const alto = altoTablaImagen(t), cuerpo = y + titulo + cabecera;
  let filas: string[][], pie: string[], pintar: (r: number, ry: number) => void = () => {};
  if (esMatriz(t)) {
    const vacio = t.tipo === 'disponible' ? '-' : '';
    filas = t.filas.map(g => [g.cd, ...g.valores.map(v => v === null ? vacio : celdaHl(v)), celdaHl(g.total)]);
    pie = ['Total general', ...t.totales.map(celdaHl), celdaHl(t.total)];
  } else {
    const color = escalaSo(t.filas.map(g => g.so), COLORES_EXCEL), lista = t.filas;
    filas = lista.map(g => [g.cd, celdaHl(g.preventa), celdaHl(g.disponible), celdaHl(g.agotados), celdaSo(g.so)]);
    pie = ['Total general', celdaHl(t.total.preventa), celdaHl(t.total.disponible), celdaHl(t.total.agotados), celdaSo(t.total.so)];
    pintar = (r, ry) => {
      ctx.fillStyle = '#fff59d'; ctx.fillRect(xs[3], ry, anchos[3], fila);
      ctx.fillStyle = `rgb(${color(lista[r].so).join(',')})`; ctx.fillRect(xs[4], ry, anchos[4], fila);
    };
  }
  ctx.fillStyle = '#f2f2f2'; ctx.fillRect(x, y, ancho, titulo);
  escribir(ctx, `${t.tipo === 'canal' ? t.canal : TITULOS_EXCEL[t.tipo]} ${fechaTexto(t.fecha)}`, x + relleno, y + titulo / 2, ancho - relleno * 2, 'center', 16, '700', '#111');
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(x, y + titulo, ancho, cabecera);
  columnas.forEach((c, i) => escribir(ctx, c, xs[i] + relleno, y + titulo + cabecera / 2, anchos[i] - relleno * 2, i ? 'right' : 'left', 12.5, '700', '#111'));
  filas.forEach((valores, r) => {
    const ry = cuerpo + r * fila;
    pintar(r, ry);
    valores.forEach((v, i) => escribir(ctx, v, xs[i] + relleno, ry + fila / 2, anchos[i] - relleno * 2, i ? 'right' : 'left', 12.5, esMatriz(t) && i === valores.length - 1 ? '700' : '400'));
    linea(ctx, x, ry + fila, x + ancho, ry + fila, '#c9c9c9', 1, true);
  });
  const piey = cuerpo + filas.length * fila;
  ctx.fillStyle = '#fff2cc'; ctx.fillRect(x, piey, ancho, fila);
  pie.forEach((v, i) => escribir(ctx, v, xs[i] + relleno, piey + fila / 2, anchos[i] - relleno * 2, i ? 'right' : 'left', 12.5, '700', '#111'));
  for (let i = 1; i < xs.length; i++) linea(ctx, xs[i], y + titulo, xs[i], y + alto, '#d4d4d4', 1, true);
  linea(ctx, x, y + titulo + cabecera, x + ancho, y + titulo + cabecera, '#bf9000', 2);
  linea(ctx, x, piey, x + ancho, piey, '#bf9000', 2);
  linea(ctx, x, y + alto, x + ancho, y + alto, '#bf9000', 2);
  ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, ancho - 1, alto - 1);
}
function exportarImagen() {
  if (!datos || !tablasCanal.length) return;
  const porFecha = new Map<number, Tabla[]>();
  for (const t of tablasCanal) porFecha.set(t.fecha, [...(porFecha.get(t.fecha) ?? []), t]);
  // Tres tablas por fila, como en la hoja: arriba el resumen y abajo TAT, KA y T4.
  const filasTablas: Tabla[][] = [];
  for (const grupo of porFecha.values()) for (let i = 0; i < grupo.length; i += 3) filasTablas.push(grupo.slice(i, i + 3));
  const { margen, ancho, separacionX, separacionY, encabezado, escala } = IMG;
  const columnas = Math.max(...filasTablas.map(f => f.length)), altos = filasTablas.map(f => Math.max(...f.map(altoTablaImagen)));
  const W = margen * 2 + columnas * ancho + (columnas - 1) * separacionX;
  const H = margen + encabezado + altos.reduce((a, b) => a + b, 0) + separacionY * (altos.length - 1) + margen;
  const lienzo = document.createElement('canvas'); lienzo.width = W * escala; lienzo.height = H * escala;
  const ctx = lienzo.getContext('2d');
  if (!ctx) { estado('No se pudo generar la imagen en este navegador.'); return; }
  ctx.scale(escala, escala);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f2f2f2'; ctx.fillRect(margen, margen, W - margen * 2, 42);
  escribir(ctx, 'PREVENTA REGIONAL NORTE', margen, margen + 21, W - margen * 2, 'center', 23, 'italic 700', '#111');
  const ahora = new Date(), dos = (n: number) => String(n).padStart(2, '0');
  const filtro = efectivos(), cds = filtro.cds.length ? filtro.cds.length <= 4 ? `CD: ${filtro.cds.join(', ')}` : plural(filtro.cds.length, 'CD seleccionado', 'CD seleccionados') : 'Todos los CD';
  const detalle = [`${porFecha.size === 1 ? 'Corte' : 'Cortes'} ${[...porFecha.keys()].map(fechaTexto).join(', ')}`, cds, filtro.canal ? `Canal ${filtro.canal}` : '', filtro.categoria ? `Categoría ${filtro.categoria}` : '', filtro.texto ? `Material «${filtro.texto}»` : '', 'Valores en HL', `Fuente: ${datos.lote.archivo}`, `Exportado el ${dos(ahora.getDate())}/${dos(ahora.getMonth() + 1)}/${ahora.getFullYear()} ${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`].filter(Boolean).join('  ·  ');
  escribir(ctx, detalle, margen, margen + 64, W - margen * 2, 'center', 13, '400', '#555');
  let y = margen + encabezado;
  filasTablas.forEach((grupo, i) => { grupo.forEach((t, j) => dibujarTablaImagen(ctx, t, margen + j * (ancho + separacionX), y)); y += altos[i] + separacionY; });
  const fechas = [...porFecha.keys()].map(fechaIso).join('_');
  lienzo.toBlob(blob => {
    if (!blob) { estado('No se pudo generar la imagen. Intenta de nuevo.'); return; }
    const url = URL.createObjectURL(blob), enlace = document.createElement('a');
    enlace.href = url; enlace.download = `Preventa_Regional_Norte_${fechas}.jpg`;
    document.body.append(enlace); enlace.click(); enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/jpeg', 0.95);
}
el('exportPv').addEventListener('click', exportar);
el('exportCanal').addEventListener('click', exportar);
el('exportImagen').addEventListener('click', exportarImagen);
el('pvTemplate').addEventListener('click', () => {
  const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([COLUMNAS_PREVENTAS]), 'Datos'); XLSX.writeFile(libro, 'Plantilla_Preventas.xlsx');
});
async function guardar(payload: { archivo: string; filas: FilaPreventa[]; snapshot?: Snapshot[]; modo: string }) {
  if (!datos || ocupado) throw new Error('Espera a que termine la operación actual.');
  ocupado = true; mostrarCarga('Guardando en Supabase', 'No cierres esta página');
  try {
    const res = await fetch('/api/preventas/guardar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, loteBase: datos.lote.id }) });
    const body = await res.json(); if (!res.ok) throw new Error(body.error);
    return body;
  } finally { ocupado = false; ocultarCarga(); }
}
el<HTMLInputElement>('pvFile').addEventListener('change', async event => {
  const control = event.target as HTMLInputElement, file = control.files?.[0]; control.value = '';
  if (!file) return;
  if (ocupado) { estado('Espera a que termine la operación actual.'); return; }
  if (!/\.(xlsx|xlsb)$/i.test(file.name) || file.size > 60 * 1024 * 1024) { estado('Selecciona un Excel .xlsx o .xlsb de hasta 60 MB.'); return; }
  pendiente = null; el('importPreview').hidden = true; ocupado = true;
  el<HTMLInputElement>('acceptExcluded').checked = false;
  el('excludedConsent').hidden = true;
  el('excludedDetails').hidden = true;
  el('baseNotice').hidden = true;
  el<HTMLButtonElement>('confirmImport').disabled = false;
  estado('Leyendo y validando el Excel. Puedes seguir consultando los reportes…');
  mostrarCarga('Validando el Excel', file.name);
  const worker = new Worker('/js/preventas-worker.js', { type: 'module' });
  worker.onmessage = event => {
    worker.terminate(); ocupado = false; ocultarCarga();
    if (event.data.error) { estado(event.data.error); return; }
    pendiente = { archivo: file.name, filas: event.data.filas, snapshot: event.data.snapshot ?? [] };
    if (event.data.base) {
      const excluidas: {fila:number;material:string;descripcion:string;motivo:string}[] = event.data.excluidas;
      el('baseNotice').hidden = false;
      el('baseNotice').textContent = `Archivo base ajustado para ${event.data.fecha}: ${pendiente.filas.length} filas listas y ${excluidas.length} excluidas. Factor, HL, categoría y CD se completan con las referencias del Excel original. Tránsitos adicionales, TMS y FRC quedan en cero porque este archivo no los contiene. No incluye un corte histórico de SO.`;
      el('excludedDetails').hidden = el('excludedConsent').hidden = !excluidas.length;
      el('excludedRows').textContent = excluidas.map(r => `Fila ${r.fila}: ${r.material} · ${r.descripcion} · ${r.motivo}`).join('\n');
      el<HTMLButtonElement>('confirmImport').disabled = !!excluidas.length;
    }
    el('importSummary').textContent = `${file.name}: ${pendiente!.filas.length} registros válidos. Guardar creará un nuevo corte activo; el corte anterior se conserva en Supabase.`;
    el('importPreview').hidden = false; estado('Archivo validado. Revisa y pulsa Guardar nuevo corte.');
  };
  worker.onerror = () => { worker.terminate(); ocupado = false; ocultarCarga(); estado('No se pudo leer el archivo. Verifica el formato y vuelve a intentar.'); };
  worker.postMessage({file, fecha: el<HTMLInputElement>('baseDate').value});
});
el('acceptExcluded').addEventListener('change', () => {
  el<HTMLButtonElement>('confirmImport').disabled = !el<HTMLInputElement>('acceptExcluded').checked;
});
el('cancelImport').addEventListener('click', () => { pendiente = null; el('importPreview').hidden = true; estado('Importación cancelada.'); });
el('confirmImport').addEventListener('click', async () => {
  if (!pendiente || ocupado) return;
  if (!el('excludedConsent').hidden && !el<HTMLInputElement>('acceptExcluded').checked) return;
  const boton = el<HTMLButtonElement>('confirmImport'); boton.disabled = true;
  try { await guardar({ ...pendiente, modo: 'importar' }); pendiente = null; el('importPreview').hidden = true; await cargar(); estado('Nuevo corte guardado en Supabase.'); }
  catch (error) { estado((error as Error).message); }
  finally { boton.disabled = false; }
});
const dialog = el<HTMLDialogElement>('recordDialog'), form = el<HTMLFormElement>('recordForm');
dialog.addEventListener('cancel', event => { if (ocupado) event.preventDefault(); });
el('pvNew').addEventListener('click', () => { if (ocupado) return; form.reset(); el('recordStatus').textContent = ''; const field = form.elements.namedItem('fecha') as HTMLInputElement; const fecha = aplicados.fechas[0]; field.value = fecha === undefined ? '' : fechaIso(fecha); dialog.showModal(); });
for (const id of ['closeRecord', 'cancelRecord']) el(id).addEventListener('click', () => { if (!ocupado) dialog.close(); });
form.addEventListener('change', event => {
  const field = event.target as HTMLInputElement;
  const set = (name: string, value: unknown) => { (form.elements.namedItem(name) as HTMLInputElement).value = String(value ?? ''); };
  if (field.name === 'material') { const f = datos?.filas.find(f => String(f.valores[3]) === field.value)?.valores; if (f) { set('descripcion', f[4]); set('factor', f[16]); set('hl', f[17]); set('categoria', f[29]); set('um', f[5]); } }
  if (field.name === 'centro') { const f = datos?.filas.find(f => f.valores[2] === field.value)?.valores; if (f) set('cd', f[21]); }
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (ocupado) return;
  const fields = new FormData(form), f: FilaPreventa = Array(35).fill(null);
  const map: [number, string][] = [[0, 'fecha'], [2, 'centro'], [3, 'material'], [4, 'descripcion'], [5, 'um'], [7, 'stock'], [8, 'planta'], [9, 'transito'], [10, 'pendiente'], [12, 'numeroPedidos'], [13, 'pedidos'], [15, 'canal'], [16, 'factor'], [17, 'hl'], [21, 'cd'], [29, 'categoria']];
  for (const [c, name] of map) f[c] = String(fields.get(name) ?? '');
  f[1] = 'TODAS';
  const boton = el<HTMLButtonElement>('saveRecord'); boton.disabled = true;
  try {
    const fila = normalizarPreventa(f); await guardar({ archivo: 'Ingreso manual', filas: [fila], modo: 'agregar' }); dialog.close(); await cargar();
    aplicados = { ...aplicados, fechas: fechasValidas(vista, [Number(fila[0])]) }; fechasVista[vista] = aplicados.fechas; pagina = 0;
    sincronizarFiltros(); render(); estado('Registro guardado en Supabase.');
  }
  catch (error) { el('recordStatus').textContent = (error as Error).message; }
  finally { boton.disabled = false; }
});
void cargar();

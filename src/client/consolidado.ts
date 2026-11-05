import { iniciarCarga } from './carga';

type Fila = Record<string, string | number | null>;
type Respuesta = { opciones: Record<string, string[]>; ultimaFecha: string; historico: boolean; filas: Fila[]; truncado: boolean; lote?: string; siguienteOffset?: number | null };
type Config = { id: string; modulo: string; tabla: string; dimensiones: string[]; pivote?: string };
const configuraciones: Record<string, Config> = {
  'Diario SKU': { id: 'diarioFilters', modulo: 'diario', tabla: 'dailyTable', dimensiones: ['cd', 'codigo_material', 'material', 'fecha_vencimiento', 'dias_venc_actual'], pivote: 'fecha_envio' },
  'Resumen': { id: 'summaryView', modulo: 'resumen', tabla: 'summaryTables', dimensiones: ['cd'] },
  'TD SKUS': { id: 'skuView', modulo: 'sku', tabla: 'skuTable', dimensiones: ['codigo_material', 'material'], pivote: 'cd' },
  'IF 30 a 60 días': { id: 'ifView', modulo: 'if', tabla: 'ifTable', dimensiones: ['codigo_material', 'material', 'cd', 'fecha_vencimiento', 'dias_venc_actual'], pivote: 'vencimiento_2' },
  'Riesgos CD': { id: 'riskView', modulo: 'riesgo', tabla: 'riskTable', dimensiones: ['gerencia', 'cd', 'codigo_material', 'material', 'fecha_vencimiento', 'dias_venc_actual'], pivote: 'vencimiento_2' },
  'Tendencia diaria': { id: 'trendView', modulo: 'tendencia', tabla: 'trendTable', dimensiones: ['cd'], pivote: 'fecha_envio' },
  'KA': { id: 'kaView', modulo: 'ka', tabla: 'kaTable', dimensiones: ['codigo_material', 'material', 'cd', 'fecha_vencimiento', 'dias_venc_actual'], pivote: 'vencimiento_2' },
  'Riesgos rango días': { id: 'rangeView', modulo: 'rango', tabla: 'rangeTables', dimensiones: ['codigo_material', 'material'], pivote: 'vencimiento_2' },
};
const campos: Record<string, string> = {
  'ano': 'anio', 'fecha envio informacion': 'fecha_envio', 'mes 1': 'mes_1', 'vencimiento 2': 'vencimiento_2',
  'linea': 'linea', 'clase envase': 'clase_envase', 'canal': 'canal', 'empaque': 'empaque', 'gerencia': 'gerencia',
  'cd': 'cd', 'codigo cd': 'codigo_cd', 'codigo material': 'codigo_material', 'fecha vencimiento': 'fecha_vencimiento',
  'dias venc actual': 'dias_venc_actual', 'costo usd': 'costo_usd',
};
const nombres: Record<string, string> = { cd: 'CD', codigo_material: 'Código material', material: 'Material', fecha_vencimiento: 'Fecha vencimiento', dias_venc_actual: 'Días venc. actual', fecha_envio: 'Fecha envío', vencimiento_2: 'Vencimiento 2', gerencia: 'Gerencia', mes_1: 'Mes', hectolitros: 'Hectolitros', valor_total: 'Valor COP', costo_usd: 'Costo USD' };
let actual: Config | undefined;
let secuencia = 0;
const modulosCargados = new Set<string>();
const consultasGuardadas = new Map<string, Respuesta>();
let consultaActiva: AbortController | null = null;
const fechasInicialesDiario = ['2026-09-02', '2026-09-04', '2026-09-08', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-18', '2026-09-21', '2026-09-22'];
let fechasDiario: Set<string> | null = new Set(fechasInicialesDiario);
let costosDiario = new Set<string>();
const filtrosEncabezadoIF = new Map<number, Set<string>>();
const filtrosEncabezadoRiesgo = new Map<number, Set<string>>();
const filtrosEncabezadoKA = new Map<number, Set<string>>();
const filtrosEncabezadoRango = new Map<number, Set<string>>();
const filtrosEncabezadoRangoCD = new Map<number, Set<string>>();
const centrosExcel = ['Apartadó', 'Cartagena KA', 'Caucasia', 'Corozal', 'Cúcuta', 'Curumaní', 'Fonseca', 'Galapa', 'La Arenosa', 'Magangué', 'Montería', 'Riohacha', 'San Andrés', 'Santa Marta', 'Turbaco', 'Valledupar', 'Atlántico', '__vacio__'];
const fechasTendencia = ['2026-09-02','2026-09-04','2026-09-08','2026-09-11','2026-09-14','2026-09-15','2026-09-18','2026-09-21','2026-09-22','2026-09-25','2026-09-28','2026-09-29','2026-10-02','2026-10-05','2026-10-06','2026-10-09','2026-10-13','2026-10-16','2026-10-21','2026-10-23'];
const iniciales: Record<string, Record<string, string[]>> = {
  diario: { anio: ['2026'], cd: ['Corozal'], codigo_material: ['22269'] },
  resumen: { fecha_envio: ['2026-10-30'], linea: ['Cervezas'], cd: centrosExcel, vencimiento_2: ['30-35 Dias','35-45 Dias','45-60 Dias'] },
  sku: { fecha_envio: ['2026-10-30'], linea: ['Cervezas'], anio: ['2026'], mes_1: ['diciembre'], cd: centrosExcel },
  if: { fecha_envio: ['2026-10-30'], linea: ['Cervezas'], codigo_material: ['16589','16590','16993','15007','16992','14779','16641'] },
  riesgo: { fecha_envio: ['2026-10-23'], linea: ['Cervezas'], cd: centrosExcel, codigo_material: ['7584'] },
  tendencia: { fecha_envio: fechasTendencia, linea: ['Cervezas'], anio: ['2026'], canal: ['KA'], cd: centrosExcel, mes_1: ['octubre','noviembre','diciembre','enero','febrero','marzo','abril','mayo','junio','julio','agosto','__vacio__'] },
  ka: { fecha_envio: ['2026-10-23'], linea: ['Cervezas'], anio: ['2026'], canal: ['KA'], cd: centrosExcel },
  rango: { fecha_envio: ['2026-10-30'], linea: ['Cervezas'], anio: ['2026'], canal: ['Ambos','Trad'], empaque: ['Botellas','Latas','Pet','__vacio__'], mes_1: ['noviembre','diciembre'], cd: centrosExcel },
};
const selecciones = new Map<string, Map<string, Set<string> | null>>();
for (const [modulo, camposIniciales] of Object.entries(iniciales)) selecciones.set(modulo, new Map(Object.entries(camposIniciales).map(([campo, valores]) => [campo, new Set(valores)])));
// Los archivos subidos desde la app pueden tener otras fechas, centros y materiales.
export function usarFiltrosRecientes() {
  for (const mapa of selecciones.values()) for (const campo of mapa.keys()) mapa.set(campo, null);
  fechasDiario = null;
  costosDiario.clear();
  // La API elige el ultimo corte en los modulos que no son historicos.
  for (const [modulo, mapa] of selecciones) if (modulo !== 'diario' && modulo !== 'tendencia') mapa.set('fecha_envio', new Set(['__ultima__']));
  document.querySelectorAll<HTMLElement>('[data-campo-multiple]').forEach(detalle => detalle.dispatchEvent(new Event('restablecer-multiple')));
}
const limpio = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const numero = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
function texto(valor: string | number | null | undefined): string {
  if (valor == null || valor === '') return '–';
  const s = String(valor);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : s;
}
function panel(config: Config): HTMLElement { return document.getElementById(config.id)!; }
function filtros(config: Config): (HTMLSelectElement | HTMLInputElement)[] { return [...panel(config).querySelectorAll<HTMLSelectElement | HTMLInputElement>('.filters-grid select, .filters-grid input')]; }
function crearFiltroMultiple(config: Config, campo: string): HTMLElement {
  const detalle = document.createElement('details'); detalle.className = 'daily-date-filter multi-filter'; detalle.dataset.campoMultiple = campo;
  const resumen = document.createElement('summary'); resumen.textContent = 'Cargando…';
  const contenido = document.createElement('div'); contenido.className = 'cost-filter-panel';
  const busqueda = document.createElement('input'); busqueda.type = 'search'; busqueda.placeholder = 'Buscar'; busqueda.setAttribute('aria-label', `Buscar ${nombres[campo] || campo}`);
  const lista = document.createElement('div'); lista.className = 'cost-filter-list';
  const acciones = document.createElement('div'); acciones.className = 'cost-filter-actions';
  const cancelar = document.createElement('button'); cancelar.type = 'button'; cancelar.textContent = 'Cancelar';
  const aceptar = document.createElement('button'); aceptar.type = 'button'; aceptar.textContent = 'Aceptar'; acciones.append(cancelar, aceptar); contenido.append(busqueda, lista, acciones); detalle.append(resumen, contenido);
  let disponibles: string[] = [], temporal = new Set<string>();
  const mostrarResumen = () => { const seleccionado = selecciones.get(config.modulo)?.get(campo) ?? null; resumen.textContent = seleccionado === null ? 'Todos' : seleccionado.has('__ultima__') ? 'Última fecha' : seleccionado.size === 1 ? texto([...seleccionado][0] === '__vacio__' ? '(en blanco)' : [...seleccionado][0]) : `${seleccionado.size} seleccionados`; };
  const dibujar = () => {
    lista.replaceChildren(); const visibles = disponibles.filter(v => limpio(v === '__vacio__' ? '(en blanco)' : texto(v)).includes(limpio(busqueda.value)));
    const opcion = (nombre: string, marcada: boolean, cambiar: (v: boolean) => void, parcial = false) => { const label = document.createElement('label'); label.className = 'daily-date-option'; const check = document.createElement('input'); check.type = 'checkbox'; check.checked = marcada; check.indeterminate = parcial; check.addEventListener('change', () => cambiar(check.checked)); label.append(check, document.createTextNode(nombre)); lista.append(label); };
    const cantidad = visibles.filter(v => temporal.has(v)).length;
    opcion('Seleccionar todo', visibles.length > 0 && cantidad === visibles.length, marcada => { visibles.forEach(v => marcada ? temporal.add(v) : temporal.delete(v)); dibujar(); }, cantidad > 0 && cantidad < visibles.length);
    visibles.forEach(v => opcion(v === '__vacio__' ? '(en blanco)' : texto(v), temporal.has(v), marcada => { if (marcada) temporal.add(v); else temporal.delete(v); }));
  };
  detalle.addEventListener('toggle', () => { if (detalle.open) { const elegidos = selecciones.get(config.modulo)?.get(campo) ?? null; temporal = new Set(elegidos ?? disponibles); busqueda.value = ''; dibujar(); } });
  busqueda.addEventListener('input', dibujar); cancelar.addEventListener('click', () => { detalle.open = false; });
  aceptar.addEventListener('click', () => { const mapa = selecciones.get(config.modulo)!; mapa.set(campo, disponibles.length && disponibles.every(v => temporal.has(v)) ? null : new Set(temporal)); detalle.open = false; mostrarResumen(); if (actual === config) void cargar(config); });
  detalle.addEventListener('opciones-multiples', e => {
    disponibles = (e as CustomEvent<string[]>).detail;
    if (campo === 'fecha_envio' && selecciones.get(config.modulo)?.get(campo)?.has('__ultima__')) selecciones.get(config.modulo)!.set(campo, new Set(disponibles.filter(Boolean).slice(-1)));
    if (!disponibles.includes('__vacio__')) disponibles = [...disponibles, '__vacio__']; mostrarResumen();
  });
  detalle.addEventListener('restablecer-multiple', () => { detalle.open = false; mostrarResumen(); });
  return detalle;
}
export function navegacionColumnas(scroll: HTMLElement): HTMLElement {
  const barra = document.createElement('div'); barra.className = 'column-navigation';
  const anterior = document.createElement('button'); anterior.type = 'button'; anterior.textContent = '‹'; anterior.setAttribute('aria-label', 'Ver columnas anteriores');
  const textoBarra = document.createElement('span'); textoBarra.textContent = 'Desplazar columnas';
  const siguiente = document.createElement('button'); siguiente.type = 'button'; siguiente.textContent = '›'; siguiente.setAttribute('aria-label', 'Ver columnas siguientes');
  const actualizar = () => { const maximo = scroll.scrollWidth - scroll.clientWidth; barra.hidden = maximo <= 1; anterior.disabled = scroll.scrollLeft <= 1; siguiente.disabled = scroll.scrollLeft >= maximo - 1; };
  anterior.addEventListener('click', () => scroll.scrollBy({ left: -300, behavior: 'smooth' })); siguiente.addEventListener('click', () => scroll.scrollBy({ left: 300, behavior: 'smooth' }));
  scroll.addEventListener('scroll', actualizar); if (typeof ResizeObserver !== 'undefined') { const observador = new ResizeObserver(actualizar); observador.observe(scroll); if (scroll.firstElementChild) observador.observe(scroll.firstElementChild); }
  barra.append(anterior, textoBarra, siguiente); requestAnimationFrame(actualizar); return barra;
}
function actualizarFechasDiario(fechas: string[]) {
  const panelFechas = document.getElementById('dailyDateFilter'); if (!panelFechas) return;
  if (fechasDiario === null) fechasDiario = new Set(fechas.slice(-9));
  const resumen = panelFechas.querySelector('summary')!;
  resumen.textContent = fechasDiario.size === fechas.length ? 'Todas las fechas' : `${fechasDiario.size} fechas seleccionadas`;
  const lista = panelFechas.querySelector('.daily-date-list')!; lista.replaceChildren();
  const crearOpcion = (etiqueta: string, marcada: boolean, accion: (checked: boolean) => void) => {
    const fila = document.createElement('label'); fila.className = 'daily-date-option';
    const casilla = document.createElement('input'); casilla.type = 'checkbox'; casilla.checked = marcada;
    casilla.addEventListener('change', () => { accion(casilla.checked); const config = configuraciones['Diario SKU']; if (actual === config) void cargar(config); });
    fila.append(casilla, document.createTextNode(etiqueta)); lista.append(fila);
  };
  crearOpcion('Seleccionar todo', fechas.length > 0 && fechasDiario.size === fechas.length, marcada => { fechasDiario = new Set(marcada ? fechas : []); });
  for (const fecha of fechas) crearOpcion(texto(fecha), fechasDiario.has(fecha), marcada => { if (marcada) fechasDiario!.add(fecha); else fechasDiario!.delete(fecha); });
}
function crearFiltroCostos(): HTMLElement {
  const detalle = document.createElement('details'); detalle.className = 'daily-date-filter cost-filter';
  const resumen = document.createElement('summary'); resumen.textContent = 'Todos';
  const panelOpciones = document.createElement('div'); panelOpciones.className = 'cost-filter-panel';
  const buscar = document.createElement('input'); buscar.type = 'search'; buscar.placeholder = 'Buscar costo'; buscar.setAttribute('aria-label', 'Buscar costo USD');
  const lista = document.createElement('div'); lista.className = 'cost-filter-list';
  const mensaje = document.createElement('p'); mensaje.className = 'cost-filter-message';
  const botones = document.createElement('div'); botones.className = 'cost-filter-actions';
  const todos = document.createElement('button'); todos.type = 'button'; todos.textContent = 'Todos';
  const aceptar = document.createElement('button'); aceptar.type = 'button'; aceptar.textContent = 'Aceptar'; botones.append(todos, aceptar);
  panelOpciones.append(buscar, lista, mensaje, botones); detalle.append(resumen, panelOpciones);
  let seleccion = new Set(costosDiario), secuenciaOpciones = 0, temporizador: ReturnType<typeof setTimeout>;
  const textoResumen = () => { resumen.textContent = !costosDiario.size ? 'Todos' : costosDiario.size === 1 ? [...costosDiario][0] === '__vacio__' ? '(en blanco)' : [...costosDiario][0].replace('.', ',') : `${costosDiario.size} costos seleccionados`; };
  const consultar = async () => {
    const ticket = ++secuenciaOpciones; mensaje.textContent = 'Buscando costos…';
    const finalizarCarga = iniciarCarga();
    try {
      const respuesta = await fetch(`/api/consolidado-opciones/costos?q=${encodeURIComponent(buscar.value)}`);
      if (!respuesta.ok) throw new Error();
      const datos: { valores: (string | null)[]; mas: boolean } = await respuesta.json(); if (ticket !== secuenciaOpciones) return;
      lista.replaceChildren();
      for (const valor of datos.valores) {
        const clave = valor === null || valor === '' ? '__vacio__' : valor;
        const etiqueta = document.createElement('label'); etiqueta.className = 'daily-date-option';
        const casilla = document.createElement('input'); casilla.type = 'checkbox'; casilla.checked = seleccion.has(clave);
        casilla.addEventListener('change', () => { if (casilla.checked) seleccion.add(clave); else seleccion.delete(clave); });
        etiqueta.append(casilla, document.createTextNode(clave === '__vacio__' ? '(en blanco)' : clave.replace('.', ','))); lista.append(etiqueta);
      }
      mensaje.textContent = datos.mas ? 'Se muestran los primeros 100 valores. Usa el buscador para encontrar otros.' : datos.valores.length ? '' : 'No se encontraron costos.';
    } catch { if (ticket === secuenciaOpciones) mensaje.textContent = 'No se pudieron cargar los costos.'; } finally { finalizarCarga(); }
  };
  detalle.addEventListener('toggle', () => { if (detalle.open) { seleccion = new Set(costosDiario); void consultar(); } });
  buscar.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(() => void consultar(), 300); });
  todos.addEventListener('click', () => { seleccion.clear(); lista.querySelectorAll<HTMLInputElement>('input').forEach(casilla => { casilla.checked = false; }); });
  aceptar.addEventListener('click', () => { costosDiario = new Set(seleccion); textoResumen(); detalle.open = false; const config = configuraciones['Diario SKU']; if (actual === config) void cargar(config); });
  detalle.addEventListener('costos-reset', () => { costosDiario.clear(); seleccion.clear(); buscar.value = ''; detalle.open = false; textoResumen(); });
  return detalle;
}
function dibujarTabla(contenedor: HTMLElement, filas: Fila[], dimensiones: string[], pivote?: string, titulo?: string, medidas = ['hectolitros']) {
  const card = document.createElement('article'); card.className = 'summary-card';
  if (titulo) { const h = document.createElement('h4'); h.textContent = titulo; card.append(h); }
  const columnas = pivote ? [...new Set(filas.map(f => String(f[pivote] ?? '(en blanco)')))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })) : [];
  const esTendencia = contenedor.id === 'trendTable';
  if (esTendencia || (contenedor.id === 'dailyTable' && columnas.length > 1)) medidas = [];
  const grupos = new Map<string, { dims: (string | number | null)[]; valores: Map<string, number>; totales: number[] }>();
  for (const f of filas) {
    const dims = dimensiones.map(d => f[d] ?? null); const clave = JSON.stringify(dims);
    let g = grupos.get(clave); if (!g) { g = { dims, valores: new Map(), totales: medidas.map(() => 0) }; grupos.set(clave, g); }
    medidas.forEach((m, i) => { g!.totales[i] += Number(f[m] || 0); });
    if (pivote) { const k = String(f[pivote] ?? '(en blanco)'); g.valores.set(k, (g.valores.get(k) || 0) + Number(f.hectolitros || 0)); }
  }
  const scroll = document.createElement('div'); scroll.className = 'summary-table-scroll';
  const tabla = document.createElement('table'); const encabezado = tabla.createTHead().insertRow();
  [...dimensiones.map(d => nombres[d] || d), ...columnas.map(texto), ...medidas.map(m => nombres[m] || m)].forEach(t => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = t; encabezado.append(th); });
  if (esTendencia) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = 'Variación'; encabezado.append(th); }
  const body = tabla.createTBody();
  const totales = medidas.map(() => 0); const totalesCol = new Map<string, number>();
  for (const g of grupos.values()) {
    g.totales.forEach((n, i) => totales[i] += n); columnas.forEach(c => totalesCol.set(c, (totalesCol.get(c) || 0) + (g.valores.get(c) || 0)));
  }
  if (contenedor.id !== 'dailyTable') {
    card.classList.add('if-report'); scroll.classList.add('if-report-scroll');
    const registros = [...grupos.values()]; let pagina = 0; const limite = 14;
    const filtrosColumnas = contenedor.id === 'ifTable' ? filtrosEncabezadoIF : contenedor.id === 'riskTable' ? filtrosEncabezadoRiesgo : contenedor.id === 'kaTable' ? filtrosEncabezadoKA : contenedor.id === 'rangeTables' ? (dimensiones.includes('codigo_material') ? filtrosEncabezadoRango : filtrosEncabezadoRangoCD) : null;
    let orden = -1, ascendente = true;
    const marco = document.createElement('div'); marco.className = 'if-report-frame';
    const pieTabla = tabla.createTFoot();
    const vertical = document.createElement('div'); vertical.className = 'if-report-vertical';
    const arriba = document.createElement('button'); arriba.type = 'button'; arriba.textContent = '⌃'; arriba.setAttribute('aria-label', 'Página anterior');
    const abajo = document.createElement('button'); abajo.type = 'button'; abajo.textContent = '⌄'; abajo.setAttribute('aria-label', 'Página siguiente');
    vertical.append(arriba, abajo); scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Tabla de hectolitros por material y vencimiento');
    scroll.append(tabla); marco.append(scroll, vertical); card.append(marco);
    const horizontal = document.createElement('div'); horizontal.className = 'if-report-horizontal';
    const izquierda = document.createElement('button'); izquierda.type = 'button'; izquierda.textContent = '‹'; izquierda.setAttribute('aria-label', 'Ver columnas anteriores');
    const estado = document.createElement('span'); estado.setAttribute('aria-live', 'polite');
    const derecha = document.createElement('button'); derecha.type = 'button'; derecha.textContent = '›'; derecha.setAttribute('aria-label', 'Ver columnas siguientes');
    horizontal.append(izquierda, estado, derecha); card.append(horizontal);
    const nota = document.createElement('p'); nota.className = 'if-report-note'; card.append(nota); contenedor.append(card);
    const renderizar = () => {
      const filtrados = filtrosColumnas ? registros.filter(grupo => [...filtrosColumnas].every(([i, valores]) => valores.has(String(grupo.dims[i] ?? '')))) : [...registros];
      const paginas = Math.max(1, Math.ceil(filtrados.length / limite)); pagina = Math.max(0, Math.min(pagina, paginas - 1)); body.replaceChildren(); pieTabla.replaceChildren();
      if (orden >= 0) filtrados.sort((a, b) => { const valorA = String(a.dims[orden] ?? ''), valorB = String(b.dims[orden] ?? ''); return (ascendente ? 1 : -1) * valorA.localeCompare(valorB, 'es', { numeric: true }); });
      for (const grupo of filtrados.slice(pagina * limite, (pagina + 1) * limite)) {
        const tr = body.insertRow();
        const variacion = esTendencia && columnas.length > 1 ? [numero((grupo.valores.get(columnas[0]) || 0) - (grupo.valores.get(columnas[columnas.length - 1]) || 0))] : esTendencia ? ['–'] : [];
        [...grupo.dims.map(texto), ...columnas.map(c => grupo.valores.has(c) ? numero(grupo.valores.get(c)!) : '–'), ...grupo.totales.map(numero), ...variacion].forEach((valor, i) => { const celda = document.createElement(i === 0 ? 'th' : 'td'); if (i === 0) celda.setAttribute('scope', 'row'); celda.textContent = valor; tr.append(celda); });
      }
      if (!filtrados.length) { const tr = body.insertRow(); const td = tr.insertCell(); td.colSpan = dimensiones.length + columnas.length + medidas.length; td.textContent = 'No hay registros para los filtros seleccionados.'; }
      else { const total = pieTabla.insertRow(); total.className = 'summary-total'; const variacion = esTendencia && columnas.length > 1 ? [numero(filtrados.reduce((s, g) => s + (g.valores.get(columnas[0]) || 0) - (g.valores.get(columnas[columnas.length - 1]) || 0), 0))] : esTendencia ? ['–'] : []; [...dimensiones.map((_, i) => i ? '' : 'Total'), ...columnas.map(c => numero(filtrados.reduce((s, g) => s + (g.valores.get(c) || 0), 0))), ...medidas.map((_, i) => numero(filtrados.reduce((s, g) => s + g.totales[i], 0))), ...variacion].forEach(v => { const td = total.insertCell(); td.textContent = v; }); }
      const paginasTexto = filtrados.length ? `Mostrando ${pagina * limite + 1}–${Math.min((pagina + 1) * limite, filtrados.length)} de ${filtrados.length.toLocaleString('es-CO')} grupos · Página ${pagina + 1} de ${paginas}` : 'Sin resultados';
      nota.textContent = `${paginasTexto}. Los totales corresponden a todos los grupos consultados.`;
      estado.textContent = `Página ${pagina + 1} de ${paginas} · ${columnas.length + dimensiones.length + medidas.length} columnas`;
      arriba.disabled = pagina === 0; abajo.disabled = pagina >= paginas - 1;
    };
    [...encabezado.cells].slice(0, dimensiones.length).forEach((th, indice) => {
      const nombre = th.textContent || ''; const boton = document.createElement('button'); boton.type = 'button'; boton.textContent = `${nombre} ↕`; boton.setAttribute('aria-label', `Ordenar por ${nombre}`); boton.addEventListener('click', () => { ascendente = orden === indice ? !ascendente : true; orden = indice; pagina = 0; renderizar(); }); th.replaceChildren(boton);
      if (!filtrosColumnas || (contenedor.id === 'riskTable' && !['codigo_material', 'material', 'fecha_vencimiento'].includes(dimensiones[indice]))) return;
      if (contenedor.id === 'kaTable' && !['codigo_material', 'fecha_vencimiento'].includes(dimensiones[indice])) return;
      const filtro = document.createElement('button'); filtro.type = 'button'; filtro.className = 'if-column-filter'; filtro.textContent = '▾'; filtro.setAttribute('aria-label', `Filtrar ${nombre}`); filtro.setAttribute('aria-haspopup', 'dialog'); filtro.title = `Filtrar ${nombre}`; th.append(filtro);
      const actualizarIndicador = () => { const activo = filtrosColumnas.has(indice); filtro.classList.toggle('is-filtered', activo); filtro.setAttribute('aria-label', `Filtrar ${nombre}${activo ? ', filtro activo' : ''}`); };
      actualizarIndicador();
      filtro.addEventListener('click', () => {
        document.querySelector('.if-filter-popover')?.remove();
        const disponibles = [...new Set(registros.filter(g => [...filtrosColumnas].every(([i, valores]) => i === indice || valores.has(String(g.dims[i] ?? '')))).map(g => String(g.dims[indice] ?? '')))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
        const existente = filtrosColumnas.get(indice); const elegidos = new Set(existente ?? disponibles);
        const ventana = document.createElement('div'); ventana.className = 'if-filter-popover'; ventana.setAttribute('role', 'dialog'); ventana.setAttribute('aria-label', `Filtrar ${nombre}`);
        const tituloVentana = document.createElement('strong'); tituloVentana.textContent = `Filtrar ${nombre}`;
        const busqueda = document.createElement('input'); busqueda.type = 'search'; busqueda.placeholder = 'Buscar'; busqueda.setAttribute('aria-label', `Buscar ${nombre}`);
        const lista = document.createElement('div'); lista.className = 'if-filter-options';
        const botones = document.createElement('div'); botones.className = 'if-filter-actions';
        const cancelar = document.createElement('button'); cancelar.type = 'button'; cancelar.textContent = 'Cancelar';
        const aceptar = document.createElement('button'); aceptar.type = 'button'; aceptar.textContent = 'Aceptar'; botones.append(cancelar, aceptar); ventana.append(tituloVentana, busqueda, lista, botones); document.body.append(ventana);
        const rect = filtro.getBoundingClientRect(); ventana.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - ventana.offsetWidth - 8))}px`;
        const actualizarLista = () => {
          lista.replaceChildren(); const visibles = disponibles.filter(v => limpio(v ? texto(v) : '(en blanco)').includes(limpio(busqueda.value)));
          const agregarOpcion = (etiqueta: string, marcado: boolean, cambiar: (checked: boolean) => void, parcial = false) => { const label = document.createElement('label'); const check = document.createElement('input'); check.type = 'checkbox'; check.checked = marcado; check.indeterminate = parcial; check.addEventListener('change', () => cambiar(check.checked)); label.append(check, document.createTextNode(etiqueta)); lista.append(label); };
          const seleccionados = visibles.filter(v => elegidos.has(v)).length;
          agregarOpcion('Seleccionar todo', visibles.length > 0 && seleccionados === visibles.length, marcado => { visibles.forEach(v => { if (marcado) elegidos.add(v); else elegidos.delete(v); }); actualizarLista(); }, seleccionados > 0 && seleccionados < visibles.length);
          visibles.forEach(v => agregarOpcion(v ? texto(v) : '(en blanco)', elegidos.has(v), marcado => { if (marcado) elegidos.add(v); else elegidos.delete(v); }));
          if (!visibles.length) { const mensaje = document.createElement('p'); mensaje.textContent = 'No se encontraron valores.'; lista.append(mensaje); }
        };
        actualizarLista(); ventana.style.top = `${Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - ventana.offsetHeight - 8))}px`; busqueda.addEventListener('input', actualizarLista);
        cancelar.addEventListener('click', () => ventana.remove());
        aceptar.addEventListener('click', () => { if (disponibles.length > 0 && disponibles.every(v => elegidos.has(v))) filtrosColumnas.delete(indice); else filtrosColumnas.set(indice, new Set(elegidos)); ventana.remove(); actualizarIndicador(); pagina = 0; renderizar(); });
        ventana.addEventListener('keydown', e => { if (e.key === 'Escape') { ventana.remove(); filtro.focus(); } }); busqueda.focus();
      });
    });
    arriba.addEventListener('click', () => { pagina--; renderizar(); }); abajo.addEventListener('click', () => { pagina++; renderizar(); });
    izquierda.addEventListener('click', () => scroll.scrollBy({ left: -300, behavior: 'smooth' })); derecha.addEventListener('click', () => scroll.scrollBy({ left: 300, behavior: 'smooth' }));
    renderizar(); return;
  }
  if (contenedor.id === 'dailyTable') {
    const registros = [...grupos.values()]; let pagina = 0;
    const pie = document.createElement('div'); pie.className = 'daily-pagination';
    const info = document.createElement('span'); info.setAttribute('aria-live', 'polite');
    const controles = document.createElement('div'); controles.className = 'daily-pagination-controls';
    const anterior = document.createElement('button'); anterior.type = 'button'; anterior.textContent = '‹'; anterior.setAttribute('aria-label', 'Página anterior');
    const indicador = document.createElement('span'); indicador.className = 'daily-page-number';
    const siguiente = document.createElement('button'); siguiente.type = 'button'; siguiente.textContent = '›'; siguiente.setAttribute('aria-label', 'Página siguiente');
    controles.append(anterior, indicador, siguiente);
    const etiqueta = document.createElement('label'); etiqueta.append(document.createTextNode('Filas por página: '));
    const tamano = document.createElement('select'); tamano.setAttribute('aria-label', 'Filas por página de Diario SKU'); [10, 20, 50].forEach(n => tamano.add(new Option(String(n), String(n)))); etiqueta.append(tamano);
    pie.append(info, controles, etiqueta); scroll.append(tabla); card.append(scroll, navegacionColumnas(scroll), pie); contenedor.append(card);
    const renderizar = () => {
      const limite = Number(tamano.value), paginas = Math.max(1, Math.ceil(registros.length / limite)); pagina = Math.max(0, Math.min(pagina, paginas - 1)); body.replaceChildren();
      for (const g of registros.slice(pagina * limite, (pagina + 1) * limite)) {
        const tr = body.insertRow();
        [...g.dims.map(texto), ...columnas.map(c => g.valores.has(c) ? numero(g.valores.get(c)!) : '–'), ...g.totales.map(numero)].forEach((v, i) => { const celda = document.createElement(i === 0 ? 'th' : 'td'); celda.textContent = v; tr.append(celda); });
      }
      if (!registros.length) { const tr = body.insertRow(); const td = tr.insertCell(); td.colSpan = dimensiones.length + columnas.length + medidas.length; td.textContent = 'No hay registros para los filtros seleccionados.'; }
      else { const tr = body.insertRow(); tr.className = 'summary-total'; [...dimensiones.map((_, i) => i ? '' : 'Total'), ...columnas.map(c => numero(totalesCol.get(c) || 0)), ...totales.map(numero)].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.append(td); }); }
      info.textContent = `Mostrando ${registros.length ? pagina * limite + 1 : 0}–${Math.min((pagina + 1) * limite, registros.length)} de ${registros.length.toLocaleString('es-CO')} registros. Totales de todos los registros filtrados.`;
      indicador.textContent = `${pagina + 1} / ${paginas}`; anterior.disabled = pagina === 0; siguiente.disabled = pagina === paginas - 1;
    };
    anterior.addEventListener('click', () => { pagina--; renderizar(); }); siguiente.addEventListener('click', () => { pagina++; renderizar(); }); tamano.addEventListener('change', () => { pagina = 0; renderizar(); });
    renderizar(); return;
  }
  const todos = [...grupos.values()]; let mostrados = 0;
  const mostrarMas = () => { for (const g of todos.slice(mostrados, mostrados + 500)) {
    const tr = body.insertRow();
    [...g.dims.map(texto), ...columnas.map(c => g.valores.has(c) ? numero(g.valores.get(c)!) : '–'), ...g.totales.map(numero)].forEach((v, i) => { const celda = document.createElement(i === 0 ? 'th' : 'td'); celda.textContent = v; tr.append(celda); });
  } mostrados = Math.min(mostrados + 500, todos.length); boton.hidden = mostrados >= todos.length; };
  const boton = document.createElement('button'); boton.type = 'button'; boton.textContent = 'Mostrar más registros'; boton.addEventListener('click', () => { body.lastElementChild?.remove(); mostrarMas(); agregarTotal(); });
  mostrarMas();
  const agregarTotal = () => { if (grupos.size) { const tr = body.insertRow(); tr.className = 'summary-total'; [...dimensiones.map((_, i) => i ? '' : 'Total'), ...columnas.map(c => numero(totalesCol.get(c) || 0)), ...totales.map(numero)].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.append(td); }); } };
  agregarTotal();
  scroll.append(tabla); card.append(scroll);
  const nota = document.createElement('p'); nota.className = 'filters-help'; nota.textContent = grupos.size ? `${grupos.size.toLocaleString('es-CO')} grupos. Los totales incluyen todos los grupos consultados.` : 'No hay registros para los filtros seleccionados.'; card.append(nota, boton); contenedor.append(card);
}
function tablaResumen(contenedor: HTMLElement, filas: Fila[], dimensiones: string[], titulo: string, icono: string) {
  const medidas = ['hectolitros', 'valor_total', 'costo_usd'];
  const agrupadas = new Map<string, Fila>();
  for (const fila of filas) {
    const clave = JSON.stringify(dimensiones.map(c => fila[c] ?? null));
    let grupo = agrupadas.get(clave);
    if (!grupo) { grupo = {}; dimensiones.forEach(c => { grupo![c] = fila[c]; }); medidas.forEach(c => { grupo![c] = 0; }); agrupadas.set(clave, grupo); }
    medidas.forEach(c => { grupo![c] = Number(grupo![c]) + Number(fila[c] || 0); });
  }
  const datos = [...agrupadas.values()]; const columnas = [...dimensiones, ...medidas];
  const card = document.createElement('article'); card.className = 'summary-card summary-report-card';
  const encabezado = document.createElement('div'); encabezado.className = 'summary-report-heading';
  const nombre = document.createElement('h4'); const simbolo = document.createElement('span'); simbolo.className = 'summary-report-icon'; simbolo.textContent = icono; nombre.append(simbolo, document.createTextNode(titulo));
  const acciones = document.createElement('div'); acciones.className = 'summary-report-actions';
  function boton(etiqueta: string, contenido: string): HTMLButtonElement { const b = document.createElement('button'); b.type = 'button'; b.title = etiqueta; b.setAttribute('aria-label', etiqueta); b.textContent = contenido; return b; }
  const buscar = boton('Buscar', '⌕'), descargar = boton('Descargar CSV', '↓'), ampliar = boton('Ampliar tabla', '⛶');
  acciones.append(buscar, descargar, ampliar); encabezado.append(nombre, acciones); card.append(encabezado);
  const campoBusqueda = document.createElement('input'); campoBusqueda.type = 'search'; campoBusqueda.className = 'summary-report-search'; campoBusqueda.placeholder = 'Buscar en la tabla…'; campoBusqueda.setAttribute('aria-label', `Buscar ${titulo}`); campoBusqueda.hidden = true; card.append(campoBusqueda);
  buscar.addEventListener('click', () => { campoBusqueda.hidden = !campoBusqueda.hidden; if (!campoBusqueda.hidden) campoBusqueda.focus(); else { campoBusqueda.value = ''; pagina = 0; renderizar(); } });
  ampliar.addEventListener('click', () => { if (document.fullscreenElement === card) void document.exitFullscreen(); else if (card.requestFullscreen) void card.requestFullscreen(); });
  const contenedorTabla = document.createElement('div'); contenedorTabla.className = 'summary-table-scroll'; const tabla = document.createElement('table'); contenedorTabla.append(tabla); card.append(contenedorTabla);
  const pie = document.createElement('div'); pie.className = 'summary-report-pagination';
  const etiqueta = document.createElement('label'); etiqueta.append(document.createTextNode('Filas por página: '));
  const tamano = document.createElement('select'); tamano.setAttribute('aria-label', `Filas por página ${titulo}`); [10, 25, 50].forEach(n => tamano.add(new Option(String(n), String(n)))); etiqueta.append(tamano);
  const info = document.createElement('span'); const controles = document.createElement('div'); controles.className = 'summary-report-pages';
  const anterior = boton('Página anterior', '↑'), indicador = document.createElement('span'), siguiente = boton('Página siguiente', '↓'); indicador.className = 'summary-report-page'; controles.append(anterior, indicador, siguiente); pie.append(etiqueta, info, controles); card.append(pie); contenedor.append(card);
  let pagina = 0, columnaOrden = '', ascendente = true;
  const obtenerFiltradas = () => {
    const consulta = limpio(campoBusqueda.value);
    const resultado = datos.filter(f => !consulta || columnas.some(c => limpio(texto(f[c])).includes(consulta)));
    if (columnaOrden) resultado.sort((a, b) => {
      const av = a[columnaOrden], bv = b[columnaOrden];
      const comparacion = medidas.includes(columnaOrden) ? Number(av || 0) - Number(bv || 0) : texto(av).localeCompare(texto(bv), 'es', { numeric: true });
      return ascendente ? comparacion : -comparacion;
    });
    return resultado;
  };
  function renderizar() {
    const filtradas = obtenerFiltradas(), limite = Number(tamano.value), paginas = Math.max(1, Math.ceil(filtradas.length / limite));
    pagina = Math.min(pagina, paginas - 1); tabla.replaceChildren();
    const cabecera = tabla.createTHead().insertRow();
    columnas.forEach(c => { const th = document.createElement('th'); th.scope = 'col'; const b = document.createElement('button'); b.type = 'button'; b.textContent = `${nombres[c] || c} ${columnaOrden === c ? (ascendente ? '↑' : '↓') : '↕'}`; b.setAttribute('aria-label', `Ordenar por ${nombres[c] || c}`); b.addEventListener('click', () => { ascendente = columnaOrden === c ? !ascendente : true; columnaOrden = c; renderizar(); }); th.append(b); cabecera.append(th); });
    const cuerpo = tabla.createTBody();
    filtradas.slice(pagina * limite, (pagina + 1) * limite).forEach(fila => { const tr = cuerpo.insertRow(); columnas.forEach((c, i) => { const celda = document.createElement(i === 0 ? 'th' : 'td'); celda.textContent = medidas.includes(c) ? numero(Number(fila[c] || 0)) : texto(fila[c]); tr.append(celda); }); });
    if (!filtradas.length) { const tr = cuerpo.insertRow(); const td = tr.insertCell(); td.colSpan = columnas.length; td.textContent = 'No hay resultados.'; }
    const total = tabla.createTFoot().insertRow(); total.className = 'summary-total';
    dimensiones.forEach((_, i) => { const td = total.insertCell(); td.textContent = i === 0 ? 'Total' : ''; });
    medidas.forEach(c => { const td = total.insertCell(); td.textContent = numero(filtradas.reduce((s, f) => s + Number(f[c] || 0), 0)); });
    info.textContent = `${filtradas.length ? pagina * limite + 1 : 0}–${Math.min((pagina + 1) * limite, filtradas.length)} de ${filtradas.length}`;
    indicador.textContent = String(pagina + 1); anterior.disabled = pagina === 0; siguiente.disabled = pagina >= paginas - 1;
  }
  anterior.addEventListener('click', () => { pagina--; renderizar(); }); siguiente.addEventListener('click', () => { pagina++; renderizar(); });
  campoBusqueda.addEventListener('input', () => { pagina = 0; renderizar(); }); tamano.addEventListener('change', () => { pagina = 0; renderizar(); });
  descargar.addEventListener('click', () => {
    const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lineas = [columnas.map(c => csv(nombres[c] || c)).join(';'), ...obtenerFiltradas().map(f => columnas.map(c => csv(String(f[c] ?? ''))).join(';'))];
    const url = URL.createObjectURL(new Blob(['\ufeff', lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })); const enlace = document.createElement('a'); enlace.href = url; enlace.download = `resumen-${limpio(titulo).replace(/\s+/g, '-')}.csv`; enlace.click(); URL.revokeObjectURL(url);
  });
  renderizar();
}
function tablaSku(contenedor: HTMLElement, filas: Fila[]) {
  const centros = [...new Set(filas.map(f => String(f.cd || '(sin CD)')))].sort((a, b) => a.localeCompare(b, 'es'));
  const grupos = new Map<string, { codigo: string; material: string; centros: Map<string, number>; total: number }>();
  for (const fila of filas) {
    const codigo = String(fila.codigo_material ?? ''), material = String(fila.material ?? ''), clave = JSON.stringify([codigo, material]);
    let grupo = grupos.get(clave);
    if (!grupo) { grupo = { codigo, material, centros: new Map(), total: 0 }; grupos.set(clave, grupo); }
    const centro = String(fila.cd || '(sin CD)'), cantidad = Number(fila.hectolitros || 0);
    grupo.centros.set(centro, (grupo.centros.get(centro) || 0) + cantidad); grupo.total += cantidad;
  }
  const registros = [...grupos.values()]; let pagina = 0, orden: 'codigo' | 'material' = 'codigo', ascendente = true;
  const tarjeta = document.createElement('div'); tarjeta.className = 'sku-report';
  const scroll = document.createElement('div'); scroll.className = 'sku-report-scroll'; scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Tabla de hectolitros por material y centro de distribución');
  const tabla = document.createElement('table'); tabla.className = 'sku-report-table'; scroll.append(tabla); tarjeta.append(scroll, navegacionColumnas(scroll));
  const pie = document.createElement('div'); pie.className = 'sku-report-footer';
  const nota = document.createElement('span'); nota.textContent = `${registros.length.toLocaleString('es-CO')} grupos. Los totales incluyen todos los grupos consultados.`;
  const paginas = document.createElement('div'); paginas.className = 'sku-report-pages';
  const etiqueta = document.createElement('label'); etiqueta.textContent = 'Filas por página: ';
  const tamano = document.createElement('select'); tamano.setAttribute('aria-label', 'Filas por página'); [14, 25, 50].forEach(n => tamano.add(new Option(String(n), String(n)))); etiqueta.append(tamano);
  pie.append(nota, paginas, etiqueta); tarjeta.append(pie); contenedor.append(tarjeta);
  const crearBoton = (textoBoton: string, descripcion: string, accion: () => void, deshabilitado = false) => {
    const boton = document.createElement('button'); boton.type = 'button'; boton.textContent = textoBoton; boton.setAttribute('aria-label', descripcion); boton.disabled = deshabilitado; boton.addEventListener('click', accion); paginas.append(boton); return boton;
  };
  function renderizar() {
    const limite = Number(tamano.value), cantidadPaginas = Math.max(1, Math.ceil(registros.length / limite)); pagina = Math.min(pagina, cantidadPaginas - 1);
    registros.sort((a, b) => (ascendente ? 1 : -1) * a[orden].localeCompare(b[orden], 'es', { numeric: true }));
    tabla.replaceChildren(); const cabecera = tabla.createTHead().insertRow();
    for (const [campo, nombre] of [['codigo', 'Código material'], ['material', 'Material']] as const) {
      const th = document.createElement('th'); th.scope = 'col'; const boton = document.createElement('button'); boton.type = 'button'; boton.textContent = `${nombre} ${orden === campo ? (ascendente ? '↑' : '↓') : '↕'}`; boton.addEventListener('click', () => { ascendente = orden === campo ? !ascendente : true; orden = campo; pagina = 0; renderizar(); }); th.append(boton); cabecera.append(th);
    }
    for (const centro of centros) { const th = document.createElement('th'); th.scope = 'col'; const pin = document.createElement('span'); pin.className = 'sku-report-pin'; pin.setAttribute('aria-hidden', 'true'); pin.textContent = '●'; th.append(pin, document.createTextNode(centro)); cabecera.append(th); }
    const totalHead = document.createElement('th'); totalHead.scope = 'col'; totalHead.textContent = 'Hectolitros'; cabecera.append(totalHead);
    const cuerpo = tabla.createTBody();
    for (const fila of registros.slice(pagina * limite, (pagina + 1) * limite)) {
      const tr = cuerpo.insertRow(); const codigo = document.createElement('th'); codigo.scope = 'row'; codigo.textContent = fila.codigo || '–'; tr.append(codigo);
      const material = tr.insertCell(); material.textContent = fila.material || '–';
      centros.forEach(centro => { const td = tr.insertCell(); td.textContent = fila.centros.has(centro) ? numero(fila.centros.get(centro)!) : '–'; });
      const total = tr.insertCell(); total.textContent = numero(fila.total);
    }
    if (!registros.length) { const tr = cuerpo.insertRow(); const td = tr.insertCell(); td.colSpan = centros.length + 3; td.textContent = 'No hay resultados para los filtros seleccionados.'; }
    const pieTabla = tabla.createTFoot().insertRow(); pieTabla.className = 'summary-total';
    const label = pieTabla.insertCell(); label.textContent = 'Total'; pieTabla.insertCell();
    centros.forEach(centro => { const td = pieTabla.insertCell(); td.textContent = numero(registros.reduce((s, fila) => s + (fila.centros.get(centro) || 0), 0)); });
    const total = pieTabla.insertCell(); total.textContent = numero(registros.reduce((s, fila) => s + fila.total, 0));
    paginas.replaceChildren(); crearBoton('«', 'Primera página', () => { pagina = 0; renderizar(); }, pagina === 0); crearBoton('‹', 'Página anterior', () => { pagina--; renderizar(); }, pagina === 0);
    const inicio = Math.max(0, Math.min(pagina - 2, cantidadPaginas - 5));
    for (let i = inicio; i < Math.min(inicio + 5, cantidadPaginas); i++) { const b = crearBoton(String(i + 1), `Página ${i + 1}`, () => { pagina = i; renderizar(); }); if (i === pagina) { b.classList.add('active'); b.setAttribute('aria-current', 'page'); } }
    crearBoton('›', 'Página siguiente', () => { pagina++; renderizar(); }, pagina >= cantidadPaginas - 1); crearBoton('»', 'Última página', () => { pagina = cantidadPaginas - 1; renderizar(); }, pagina >= cantidadPaginas - 1);
  }
  tamano.addEventListener('change', () => { pagina = 0; renderizar(); }); renderizar();
}
function principales(filas: Fila[], cantidad: number, porCentro = false): Fila[] {
  const totales = new Map<string, Map<string, number>>();
  for (const fila of filas) {
    const centro = porCentro ? String(fila.cd ?? '') : ''; const codigo = String(fila.codigo_material ?? '');
    let codigos = totales.get(centro); if (!codigos) { codigos = new Map(); totales.set(centro, codigos); }
    codigos.set(codigo, (codigos.get(codigo) || 0) + Number(fila.hectolitros || 0));
  }
  const elegidos = new Map([...totales].map(([centro, codigos]) => [centro, new Set([...codigos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es', { numeric: true })).slice(0, cantidad).map(([codigo]) => codigo))]));
  return filas.filter(fila => elegidos.get(porCentro ? String(fila.cd ?? '') : '')?.has(String(fila.codigo_material ?? '')));
}
const compromiso = { hectolitros: 281, valor_total: 55577465.02, costo_usd: -5660.67805396609 };
function mostrarCompromiso(contenedor: HTMLElement, filas: Fila[]) {
  const section = document.createElement('section'); section.className = 'compromiso-card';
  const titulo = document.createElement('h4'); titulo.textContent = 'Compromiso y riesgo · diciembre';
  const descripcion = document.createElement('p'); descripcion.textContent = 'Compromiso: valores iniciales del Excel; los cambios solo duran en esta página. Riesgo: datos de diciembre menos compromiso (en USD se suma el ajuste).';
  const diciembre = filas.filter(f => limpio(String(f.mes_1 || '')) === 'diciembre');
  const total = { hectolitros: 0, valor_total: 0, costo_usd: 0 }; diciembre.forEach(f => { for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += Number(f[k] || 0); });
  const table = document.createElement('table'); const head = table.createTHead().insertRow(); ['Indicador','Hectolitros','Valor COP','Costo USD'].forEach(v => { const th = document.createElement('th'); th.textContent = v; head.append(th); });
  const body = table.createTBody(), filaCompromiso = body.insertRow(), filaRiesgo = body.insertRow(); filaCompromiso.insertCell().textContent = 'Compromiso'; filaRiesgo.insertCell().textContent = 'Riesgo';
  for (const k of ['hectolitros','valor_total','costo_usd'] as const) {
    const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(compromiso[k]); input.setAttribute('aria-label', `Compromiso ${nombres[k]}`); filaCompromiso.insertCell().append(input);
    const valor = filaRiesgo.insertCell(); const actualizar = () => { const n = Number(input.value); compromiso[k] = Number.isFinite(n) ? n : 0; valor.textContent = diciembre.length ? numero(k === 'costo_usd' ? total[k] + compromiso[k] : total[k] - compromiso[k]) : 'Sin datos de diciembre'; }; input.addEventListener('input', actualizar); actualizar();
  }
  section.append(titulo, descripcion, table); contenedor.append(section);
}
function mostrarResumenTendencia(filas: Fila[]) {
  const destino = document.getElementById('trendTotals')!; destino.replaceChildren();
  const fechas = [...new Set(filas.map(f => String(f.fecha_envio || '').slice(0, 10)).filter(Boolean))].sort();
  if (fechas.length < 2) return;
  const primero = fechas[0], ultimo = fechas[fechas.length - 1]; let total = 0;
  for (const mes of ['octubre','noviembre','diciembre']) {
    const diferencia = filas.filter(f => limpio(String(f.mes_1 || '')) === mes).reduce((s, f) => s + (String(f.fecha_envio).startsWith(primero) ? Number(f.hectolitros || 0) : String(f.fecha_envio).startsWith(ultimo) ? -Number(f.hectolitros || 0) : 0), 0); total += diferencia;
    const item = document.createElement('div'), label = document.createElement('span'), valor = document.createElement('strong'); label.textContent = mes; valor.textContent = numero(diferencia); item.append(label, valor); destino.append(item);
  }
  const item = document.createElement('div'), label = document.createElement('span'), valor = document.createElement('strong'); label.textContent = 'Total oct–dic'; valor.textContent = numero(total); item.append(label, valor); destino.append(item);
}
async function cargar(config: Config) {
  const ticket = ++secuencia; consultaActiva?.abort(); const controlador = new AbortController(); consultaActiva = controlador;
  modulosCargados.delete(config.modulo);
  const destino = document.getElementById(config.tabla)!;
  const finalizarCarga = iniciarCarga();
  destino.replaceChildren(); destino.textContent = 'Consultando información…';
  const params = new URLSearchParams(); filtros(config).forEach(s => { if (s.dataset.campo && s.value) params.set(s.dataset.campo, s.value); });
  params.set('paginado', '1');
  for (const detalle of panel(config).querySelectorAll<HTMLElement>('[data-campo-multiple]')) {
    const campo = detalle.dataset.campoMultiple!; const seleccion = selecciones.get(config.modulo)?.get(campo) ?? null;
    if (campo === 'fecha_envio' && seleccion?.has('__ultima__')) continue;
    if (seleccion === null) { if (campo === 'fecha_envio') params.append(campo, '__todas__'); }
    else if (!seleccion.size) params.append(campo, '__ninguna__');
    else [...seleccion].sort().forEach(valor => params.append(campo, valor));
  }
  if (config.modulo === 'diario' && fechasDiario !== null) {
    if (!fechasDiario.size) params.append('fecha_envio', '__ninguna__');
    else [...fechasDiario].sort().forEach(fecha => params.append('fecha_envio', fecha));
  }
  if (config.modulo === 'diario') [...costosDiario].sort().forEach(costo => params.append('costo_usd', costo));
  params.sort(); const claveConsulta = `${config.modulo}?${params}`;
  try {
    let data = consultasGuardadas.get(claveConsulta);
    if (!data) {
      const response = await fetch(`/api/consolidado/${config.modulo}?${params}`, { signal: controlador.signal });
      if (!response.ok) throw new Error('No se pudo consultar la información.');
      data = await response.json() as Respuesta;
      // Se completan todas las paginas antes de calcular las tablas y sus totales.
      let offsetAnterior = 0;
      while (data.siguienteOffset != null) {
        const offset = data.siguienteOffset;
        if (!Number.isSafeInteger(offset) || offset <= offsetAnterior || offset >= 200000 || !data.lote) throw new Error('La paginación recibida no es válida.');
        offsetAnterior = offset;
        const paginaParams = new URLSearchParams(params);
        paginaParams.set('offset', String(offset));
        paginaParams.set('lote', data.lote);
        const paginaResponse = await fetch(`/api/consolidado/${config.modulo}?${paginaParams}`, { signal: controlador.signal });
        if (!paginaResponse.ok) throw new Error('No se pudo completar la consulta.');
        const pagina = await paginaResponse.json() as Respuesta;
        if (pagina.lote !== data.lote) throw new Error('El informe cambió durante la consulta.');
        data.filas.push(...pagina.filas);
        data.truncado = data.truncado || pagina.truncado;
        data.siguienteOffset = pagina.siguienteOffset;
      }
      if (consultasGuardadas.size >= 20) { const primera = consultasGuardadas.keys().next().value; if (primera !== undefined) consultasGuardadas.delete(primera); }
      consultasGuardadas.set(claveConsulta, data);
    }
    if (ticket !== secuencia || actual !== config) return;
    filtros(config).forEach(s => {
      const campo = s.dataset.campo; if (!campo) return;
      if (s instanceof HTMLInputElement) { s.disabled = false; return; }
      const elegido = s.value; s.replaceChildren(new Option(campo === 'fecha_envio' && config.modulo !== 'tendencia' ? 'Última fecha' : 'Todos', ''));
      if (campo === 'fecha_envio' && (config.modulo === 'diario' || config.modulo === 'tendencia')) s.add(new Option('Todas las fechas', '__todas__'));
      for (const valor of data.opciones[campo] || []) if (valor !== '') s.add(new Option(texto(valor), valor));
      s.value = elegido; s.disabled = false;
    });
    panel(config).querySelectorAll<HTMLElement>('[data-campo-multiple]').forEach(detalle => { detalle.dispatchEvent(new CustomEvent('opciones-multiples', { detail: data.opciones[detalle.dataset.campoMultiple!] || [] })); });
    if (config.modulo === 'diario') actualizarFechasDiario(data.opciones.fecha_envio || []);
    const ayuda = panel(config).querySelector<HTMLElement>('.filters-help');
    if (ayuda) {
      const fechas = selecciones.get(config.modulo)?.get('fecha_envio');
      ayuda.textContent = config.modulo === 'diario' ? 'Las fechas y selecciones iniciales corresponden al Excel. Puedes comparar varios cortes en columnas.' : config.modulo === 'tendencia' ? 'La variación se calcula como el primer corte menos el último; el resumen suma octubre, noviembre y diciembre.' : fechas === null || fechas === undefined ? 'Se incluyen todos los cortes seleccionados; sumar fechas diferentes acumula instantáneas de inventario.' : fechas.size > 1 ? 'Se suman los cortes seleccionados; cada fecha representa una instantánea distinta.' : 'Las selecciones iniciales corresponden a las guardadas en el Excel.';
    }
    destino.replaceChildren();
    if (data.truncado) { const aviso = document.createElement('p'); aviso.textContent = 'La consulta supera 200.000 grupos. Aplica filtros adicionales: los totales mostrados son parciales.'; destino.append(aviso); }
    if (config.modulo === 'resumen') {
      tablaResumen(destino, data.filas, ['cd'], 'Por centro de distribución', '⌂');
      tablaResumen(destino, principales(data.filas, 5), ['codigo_material', 'material'], 'Por material · 5 principales', '◇');
      tablaResumen(destino, data.filas, ['mes_1'], 'Por mes', '▦');
      mostrarCompromiso(destino, data.filas);
    } else if (config.modulo === 'sku') {
      tablaSku(destino, principales(data.filas, 5));
    } else if (config.modulo === 'rango') {
      dibujarTabla(destino, principales(data.filas, 15), config.dimensiones, config.pivote, 'Por material · 15 principales');
      dibujarTabla(destino, principales(data.filas, 15, true), ['cd'], config.pivote, 'Por centro de distribución');
    } else { if (config.modulo === 'tendencia') mostrarResumenTendencia(data.filas); dibujarTabla(destino, data.filas, config.dimensiones, config.pivote); }
    modulosCargados.add(config.modulo);
  } catch { if (ticket === secuencia && actual === config && !controlador.signal.aborted) destino.textContent = 'No se pudo consultar el consolidado. Comprueba la conexión a Supabase.'; } finally { if (consultaActiva === controlador) consultaActiva = null; finalizarCarga(); }
}
export function mostrarConsolidado(nombre: string): boolean {
  document.querySelector('.if-filter-popover')?.remove();
  actual = configuraciones[nombre];
  if (!actual) { secuencia++; consultaActiva?.abort(); return false; }
  if (modulosCargados.has(actual.modulo)) { secuencia++; consultaActiva?.abort(); return true; }
  void cargar(actual); return true;
}
export function prepararConsolidado() {
  for (const config of Object.values(configuraciones)) {
    const seccion = panel(config);
    const vista = config.modulo === 'diario' ? document.getElementById('dailyView')! : seccion;
    vista.querySelectorAll<HTMLElement>('.summary-heading p').forEach(p => { p.textContent = 'Información calculada a partir del consolidado de Supabase.'; });
    vista.querySelectorAll<HTMLElement>('.source-badge').forEach(b => { b.textContent = 'Datos consolidados'; });
    if (['diario', 'if', 'riesgo'].includes(config.modulo)) {
      const grid = seccion.querySelector('.filters-grid');
      if (grid) { const label = document.createElement('label'); label.className = 'filter-field'; label.append(document.createTextNode('Código material')); const select = document.createElement('select'); select.disabled = true; label.append(select); grid.append(label); }
    }
    for (const label of seccion.querySelectorAll<HTMLLabelElement>('.filter-field')) {
      const select = label.querySelector('select'); if (!select) continue;
      const campo = campos[limpio(label.childNodes[0]?.textContent || '')]; if (!campo) continue;
      if (config.modulo === 'diario' && campo === 'fecha_envio') {
        const detalle = document.createElement('details'); detalle.id = 'dailyDateFilter'; detalle.className = 'daily-date-filter';
        const resumen = document.createElement('summary'); resumen.textContent = 'Cargando fechas…';
        const lista = document.createElement('div'); lista.className = 'daily-date-list'; detalle.append(resumen, lista);
        const campoFecha = document.createElement('div'); campoFecha.className = 'filter-field'; const titulo = document.createElement('span'); titulo.textContent = label.childNodes[0]?.textContent || 'Fecha envío información'; campoFecha.append(titulo, detalle); label.replaceWith(campoFecha); continue;
      }
      if (config.modulo === 'diario' && campo === 'costo_usd') {
        const campoCosto = document.createElement('div'); campoCosto.className = 'filter-field'; const titulo = document.createElement('span'); titulo.textContent = label.childNodes[0]?.textContent || 'Costo USD'; campoCosto.append(titulo, crearFiltroCostos()); label.replaceWith(campoCosto); continue;
      }
      const multiple = crearFiltroMultiple(config, campo); const campoUI = document.createElement('div'); campoUI.className = 'filter-field'; const titulo = document.createElement('span'); titulo.textContent = label.childNodes[0]?.textContent || campo; campoUI.append(titulo, multiple); label.replaceWith(campoUI);
    }
    const heading = seccion.querySelector('.filters-heading');
    if (heading && !heading.querySelector('button')) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Limpiar filtros'; heading.append(b); }
    heading?.querySelector('button')?.addEventListener('click', event => { event.stopImmediatePropagation(); selecciones.set(config.modulo, new Map()); seccion.querySelectorAll('[data-campo-multiple]').forEach(d => d.dispatchEvent(new Event('restablecer-multiple'))); if (config.modulo === 'diario') { fechasDiario = null; seccion.querySelector('.cost-filter')?.dispatchEvent(new Event('costos-reset')); } if (config.modulo === 'if') filtrosEncabezadoIF.clear(); if (config.modulo === 'riesgo') filtrosEncabezadoRiesgo.clear(); if (config.modulo === 'ka') filtrosEncabezadoKA.clear(); if (config.modulo === 'rango') { filtrosEncabezadoRango.clear(); filtrosEncabezadoRangoCD.clear(); } if (actual === config) void cargar(config); }, true);
    const filtrosPanel = seccion.classList.contains('filters-panel') ? seccion : seccion.querySelector<HTMLElement>('.filters-panel');
    if (filtrosPanel) { const accion = document.createElement('div'); accion.className = 'filter-actions'; const aplicar = document.createElement('button'); aplicar.type = 'button'; aplicar.className = 'apply-filters'; aplicar.textContent = '⌕  Aplicar filtros'; aplicar.addEventListener('click', () => { if (actual === config) void cargar(config); }); accion.append(aplicar); filtrosPanel.append(accion); }
  }
}

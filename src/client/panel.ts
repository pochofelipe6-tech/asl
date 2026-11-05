import { porId } from './dom';
import { mostrarConsolidado, prepararConsolidado, navegacionColumnas } from './consolidado';
import { iniciarCarga } from './carga';

interface Sheet { id: number; name: string; startRow: number; startColumn?: number; rows: number; columns: number }
interface Index { sheets: Sheet[] }
const modules = porId('modules');
const table = porId<HTMLTableElement>('dataTable');
const search = porId<HTMLInputElement>('search');
const previous = porId<HTMLButtonElement>('previous');
const next = porId<HTMLButtonElement>('next');
const empty = porId('empty');
const dialog = porId<HTMLDialogElement>('rowDialog');
const diarioFilters = porId('diarioFilters');
const dailyView = porId('dailyView');
const summaryView = porId('summaryView');
const summaryTables = porId('summaryTables');
const skuView = porId('skuView');
const skuCd = porId<HTMLSelectElement>('skuCd');
const ifView = porId('ifView');
const ifCd = porId<HTMLSelectElement>('ifCd');
const riskView = porId('riskView');
const riskGerencia = porId<HTMLSelectElement>('riskGerencia');
const riskCd = porId<HTMLSelectElement>('riskCd');
const trendView = porId('trendView');
const trendCd = porId<HTMLSelectElement>('trendCd');
const kaView = porId('kaView');
const kaCd = porId<HTMLSelectElement>('kaCd');
const rangeView = porId('rangeView');
const filterCd = porId<HTMLSelectElement>('filterCd');
const pageSize = 5;
const themeToggle = porId<HTMLButtonElement>('themeToggle');
function applyTheme(light: boolean) {
  document.documentElement.dataset.tema = light ? 'claro' : 'oscuro';
  themeToggle.setAttribute('aria-pressed', String(light));
  porId('themeLabel').textContent = light ? 'Modo oscuro' : 'Modo claro';
}
applyTheme(document.documentElement.dataset.tema === 'claro');
themeToggle.addEventListener('click', () => {
  const light = document.documentElement.dataset.tema !== 'claro';
  const bulb = themeToggle.querySelector<HTMLElement>('.theme-bulb');
  if (bulb) {
    bulb.classList.remove('bulb-turning-on', 'bulb-turning-off');
    void bulb.offsetWidth;
    bulb.classList.add(light ? 'bulb-turning-on' : 'bulb-turning-off');
  }
  applyTheme(light);
  try { localStorage.setItem('frescura-tema', light ? 'claro' : 'oscuro'); } catch { /* La página funciona aunque el navegador bloquee el almacenamiento. */ }
});
let rows: string[][] = [];
let filtered: { row: string[]; number: number }[] = [];
let page = 0;
let requestId = 0;
let startRow = 1;
let sheetName = '';
let startColumn = 0;
let rowCenters: string[] = [];

function renderDaily() {
  const container = porId('dailyTable'); container.replaceChildren();
  const index = rows.findIndex(row => row[0]?.trim() === 'CD' && row[1]?.trim() === 'Código Material' && row[2]?.trim() === 'Material' && row[3]?.trim() === 'Fecha Vencimiento');
  if (index < 0) { container.textContent = 'No se encontró la tabla de Diario SKU en esta hoja.'; return; }
  const header = rows[index];
  let end = header.length - 1;
  while (end > 4 && !header[end]?.trim()) end--;
  const scroll = document.createElement('div'); scroll.className = 'summary-table-scroll';
  const table = document.createElement('table'); const head = table.createTHead().insertRow();
  header.slice(0, end + 1).forEach(value => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value.trim(); head.append(th); });
  const body = table.createTBody();
  let cd = '', code = '', material = '', count = 0;
  for (const source of rows.slice(index + 1)) {
    const row = source.slice(0, end + 1);
    if (!row.some(value => value.trim())) break;
    const label = row[0]?.trim() || '';
    const total = /^total\b/i.test(label) || label.toLocaleLowerCase('es') === 'hectolitros';
    if (total && filterCd.value) continue;
    if (!total) {
      if (label) { cd = label; code = ''; material = ''; }
      if (row[1]?.trim()) code = row[1].trim();
      if (row[2]?.trim()) material = row[2].trim();
      if (!row[3]?.trim() || (filterCd.value && cd !== filterCd.value)) continue;
      row[0] = cd; row[1] = code; row[2] = material;
      const date = row[3].match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (date) row[3] = `${date[2].padStart(2, '0')}/${date[1].padStart(2, '0')}/20${date[3]}`;
      count++;
    }
    const tr = body.insertRow(); if (total) tr.className = 'summary-total';
    row.forEach((value, col) => { const cell = col === 0 ? document.createElement('th') : document.createElement('td'); if (col === 0) cell.scope = 'row'; cell.textContent = value.trim() || '–'; tr.append(cell); });
    if (total && label.toLocaleLowerCase('es') === 'hectolitros') break;
  }
  scroll.append(table); container.append(scroll);
  if (!count) { const message = document.createElement('p'); message.className = 'empty'; message.textContent = 'No hay registros para el centro seleccionado.'; container.append(message); }
}

function renderRange() {
  const container = porId('rangeTables'); container.replaceChildren();
  const index = rows.findIndex(row => row[0]?.trim() === 'Código Material' && row[1]?.trim() === 'Material' && row.some(value => value.trim() === 'CD'));
  if (index < 0) { container.textContent = 'No se encontraron las tablas en esta hoja.'; return; }
  const header = rows[index];
  const centerStart = header.findIndex((value, col) => col > 1 && value.trim() === 'CD');
  const definitions = [{ title: 'Riesgo por material', start: 0 }, { title: 'Riesgo por centro de distribución', start: centerStart }];
  for (const definition of definitions) {
    const end = header.findIndex((value, col) => col > definition.start && value.trim() === 'Hectolitros');
    if (definition.start < 0 || end < 0) { container.textContent = 'No se encontraron las tablas completas en esta hoja.'; return; }
    const card = document.createElement('article'); card.className = 'summary-card';
    const title = document.createElement('h4'); title.textContent = definition.title; card.append(title);
    const scroll = document.createElement('div'); scroll.className = 'summary-table-scroll';
    const table = document.createElement('table'); const head = table.createTHead().insertRow();
    header.slice(definition.start, end + 1).forEach(value => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value.trim(); head.append(th); });
    const body = table.createTBody();
    for (const source of rows.slice(index + 1)) {
      const row = source.slice(definition.start, end + 1);
      if (!row.some(value => value.trim())) break;
      const total = row[0]?.trim() === 'Hectolitros'; const tr = body.insertRow(); if (total) tr.className = 'summary-total';
      row.forEach((value, col) => { const cell = col === 0 ? document.createElement('th') : document.createElement('td'); if (col === 0) cell.scope = 'row'; cell.textContent = total && col === 0 ? 'Total' : value.trim() || '–'; tr.append(cell); });
      if (total) break;
    }
    scroll.append(table); card.append(scroll); container.append(card);
  }
}

function renderKa(prepare = false) {
  const container = porId('kaTable'); container.replaceChildren();
  const index = rows.findIndex(row => row[0]?.trim() === 'Código Material' && row[1]?.trim() === 'Material' && row[2]?.trim() === 'CD' && row[3]?.trim() === 'Fecha Vencimiento');
  if (index < 0) { container.textContent = 'No se encontró la tabla en esta hoja.'; return; }
  const header = rows[index];
  const end = header.findIndex((value, col) => col > 2 && value.trim() === 'Hectolitros');
  if (end < 0) { container.textContent = 'No se encontró el total de la tabla.'; return; }
  const dateRow = rows.slice(0, index).find(row => row[0]?.trim().toLocaleLowerCase('es') === 'fecha envio información');
  porId('kaDate').textContent = dateRow?.[1] ? `Fecha de envío de información: ${dateRow[1]}` : 'Valores guardados en el archivo Excel';
  const entries: { row: string[]; total: boolean }[] = [];
  let code = '', material = '', center = '';
  for (const source of rows.slice(index + 1)) {
    const row = source.slice(0, end + 1);
    if (!row.some(value => value.trim())) break;
    const label = row[0]?.trim() || '';
    if (/^total\b/i.test(label) || label === 'Hectolitros') {
      entries.push({ row, total: true });
      if (label === 'Hectolitros') break;
      continue;
    }
    if (label) { code = label; material = ''; center = ''; }
    if (row[1]?.trim()) material = row[1].trim();
    if (row[2]?.trim()) center = row[2].trim();
    if (row[3]?.trim()) { row[0] = code; row[1] = material; row[2] = center; entries.push({ row, total: false }); }
  }
  if (prepare) {
    kaCd.replaceChildren(new Option('Todos los centros', ''));
    [...new Set(entries.filter(entry => !entry.total).map(entry => entry.row[2]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')).forEach(value => kaCd.add(new Option(value, value)));
  }
  const scroll = document.createElement('div'); scroll.className = 'summary-table-scroll';
  const table = document.createElement('table'); const head = table.createTHead().insertRow();
  header.slice(0, end + 1).forEach(value => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value.trim(); head.append(th); });
  const body = table.createTBody();
  const filtered = entries.filter(entry => entry.total ? !kaCd.value : !kaCd.value || entry.row[2] === kaCd.value);
  for (const entry of filtered) {
    const tr = body.insertRow(); if (entry.total) tr.className = 'summary-total';
    entry.row.forEach((value, col) => { const cell = col === 0 ? document.createElement('th') : document.createElement('td'); if (col === 0) cell.scope = 'row'; cell.textContent = entry.total && col === 0 && value.trim() === 'Hectolitros' ? 'Total' : value.trim() || '–'; tr.append(cell); });
  }
  scroll.append(table); container.append(scroll);
  if (!filtered.length) { const message = document.createElement('p'); message.className = 'empty'; message.textContent = 'No hay resultados para esta selección.'; container.append(message); }
}
kaCd.addEventListener('change', () => renderKa());
porId('kaClear').addEventListener('click', () => { kaCd.value = ''; renderKa(); });

function renderTrend(prepare = false) {
  const container = porId('trendTable'); container.replaceChildren();
  const totals = porId('trendTotals'); totals.replaceChildren();
  const index = rows.findIndex(row => row[0]?.trim() === 'CD' && row.some(value => value.trim() === 'Var'));
  if (index < 0) { container.textContent = 'No se encontró la tabla en esta hoja.'; return; }
  const header = rows[index]; const end = header.findIndex(value => value.trim() === 'Var');
  const details: string[][] = []; let total: string[] | undefined;
  for (const row of rows.slice(index + 1)) {
    if (!row[0]?.trim()) break;
    if (row[0].trim() === 'Hectolitros') { total = row; break; }
    details.push(row);
  }
  if (prepare) {
    trendCd.replaceChildren(new Option('Todos los centros', ''));
    details.map(row => row[0].trim()).sort((a, b) => a.localeCompare(b, 'es')).forEach(center => trendCd.add(new Option(center, center)));
  }
  if (!trendCd.value) {
    const summaryIndex = rows.findIndex(row => row[3]?.trim() === 'Oct' && row[4]?.trim() === 'Nov' && row[5]?.trim() === 'Dic' && row[6]?.trim() === 'Total');
    if (summaryIndex >= 0 && rows[summaryIndex + 1]) {
      for (let col = 3; col <= 6; col++) {
        const item = document.createElement('div'); const label = document.createElement('span'); const value = document.createElement('strong');
        label.textContent = rows[summaryIndex][col].trim(); value.textContent = rows[summaryIndex + 1][col].trim() || '–'; item.append(label, value); totals.append(item);
      }
    }
  }
  const scroll = document.createElement('div'); scroll.className = 'summary-table-scroll';
  const table = document.createElement('table'); const head = table.createTHead().insertRow();
  header.slice(0, end + 1).forEach(value => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value.trim(); head.append(th); });
  const body = table.createTBody();
  const selected = details.filter(row => !trendCd.value || row[0].trim() === trendCd.value);
  if (!trendCd.value && total) selected.push(total);
  for (const row of selected) {
    const tr = body.insertRow(); const isTotal = row[0].trim() === 'Hectolitros'; if (isTotal) tr.className = 'summary-total';
    row.slice(0, end + 1).forEach((value, col) => { const cell = col === 0 ? document.createElement('th') : document.createElement('td'); if (col === 0) cell.scope = 'row'; cell.textContent = isTotal && col === 0 ? 'Total' : value.trim() || '–'; tr.append(cell); });
  }
  scroll.append(table); container.append(scroll);
}
trendCd.addEventListener('change', () => renderTrend());
porId('trendClear').addEventListener('click', () => { trendCd.value = ''; renderTrend(); });

function renderRisk(prepare = false) {
  const container = porId('riskTable'); container.replaceChildren();
  const index = rows.findIndex(row => row[0]?.trim() === 'Gerencia' && row[1]?.trim() === 'CD' && row[2]?.trim() === 'Código Material');
  if (index < 0) { container.textContent = 'No se encontró la tabla en esta hoja.'; return; }
  const header = rows[index];
  const totalIndex = header.findIndex((value, col) => col > 2 && value.trim() === 'Hectolitros');
  if (totalIndex < 0) { container.textContent = 'No se encontró el total de la tabla.'; return; }
  const dateRow = rows.slice(0, index).find(row => row[0]?.trim().toLocaleLowerCase('es') === 'fecha envio información');
  porId('riskDate').textContent = dateRow?.[1] ? `Fecha de envío de información: ${dateRow[1]}` : 'Valores guardados en el archivo Excel';
  const entries: { row: string[]; total: boolean }[] = [];
  let gerencia = '', center = '', code = '', material = '';
  for (const source of rows.slice(index + 1)) {
    const row = source.slice(0, totalIndex + 1);
    if (!row.some(value => value.trim())) break;
    const label = row[0]?.trim() || '';
    if (/^total\b/i.test(label) || label === 'Hectolitros') {
      entries.push({ row, total: true });
      if (label === 'Hectolitros') break;
      continue;
    }
    if (label) { gerencia = label; center = ''; code = ''; material = ''; }
    if (row[1]?.trim()) { center = row[1].trim(); code = ''; material = ''; }
    if (row[2]?.trim()) code = row[2].trim();
    if (row[3]?.trim()) material = row[3].trim();
    if (row[4]?.trim()) { row[0] = gerencia; row[1] = center; row[2] = code; row[3] = material; entries.push({ row, total: false }); }
  }
  if (prepare) {
    riskGerencia.replaceChildren(new Option('Todas las gerencias', '')); riskCd.replaceChildren(new Option('Todos los centros', ''));
    const details = entries.filter(entry => !entry.total);
    [...new Set(details.map(entry => entry.row[0]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')).forEach(value => riskGerencia.add(new Option(value, value)));
    [...new Set(details.map(entry => entry.row[1]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')).forEach(value => riskCd.add(new Option(value, value)));
  }
  const scroll = document.createElement('div'); scroll.className = 'summary-table-scroll';
  const table = document.createElement('table'); const head = table.createTHead().insertRow();
  header.slice(0, totalIndex + 1).forEach(value => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value.trim(); head.append(th); });
  const body = table.createTBody();
  const filtered = entries.filter(entry => entry.total ? !riskCd.value && !riskGerencia.value : (!riskGerencia.value || entry.row[0] === riskGerencia.value) && (!riskCd.value || entry.row[1] === riskCd.value));
  for (const entry of filtered) {
    const tr = body.insertRow(); if (entry.total) tr.className = 'summary-total';
    entry.row.forEach((value, col) => { const cell = col === 0 ? document.createElement('th') : document.createElement('td'); if (col === 0) cell.scope = 'row'; cell.textContent = entry.total && col === 0 && value.trim() === 'Hectolitros' ? 'Total' : value.trim() || '–'; tr.append(cell); });
  }
  scroll.append(table); container.append(scroll);
  if (!filtered.length) { const message = document.createElement('p'); message.className = 'empty'; message.textContent = 'No hay resultados para esta selección.'; container.append(message); }
}
riskGerencia.addEventListener('change', () => renderRisk());
riskCd.addEventListener('change', () => renderRisk());
porId('riskClear').addEventListener('click', () => { riskGerencia.value = ''; riskCd.value = ''; renderRisk(); });

function renderIf(prepare = false) {
  const container = porId('ifTable'); container.replaceChildren();
  const headerIndex = rows.findIndex(row => row[0]?.trim() === 'Código Material' && row[1]?.trim() === 'Material' && row[2]?.trim() === 'CD' && row[3]?.trim() === 'Fecha Vencimiento');
  if (headerIndex < 0) { container.textContent = 'No se encontró la tabla en esta hoja.'; return; }
  const header = rows[headerIndex];
  const totalIndex = header.findIndex((value, col) => col > 2 && value.trim() === 'Hectolitros');
  if (totalIndex < 0) { container.textContent = 'No se encontró el total de la tabla.'; return; }
  const dateRow = rows.slice(0, headerIndex).find(row => row[0]?.trim().toLocaleLowerCase('es') === 'fecha envio información');
  porId('ifDate').textContent = dateRow?.[1] ? `Fecha de envío de información: ${dateRow[1]}` : 'Valores guardados en el archivo Excel';
  const items: string[][] = [];
  let code = '', material = '', center = '';
  let total: string[] | undefined;
  for (const source of rows.slice(headerIndex + 1)) {
    const row = source.slice(0, totalIndex + 1);
    if (!row.some(value => value.trim())) break;
    if (row[0]?.trim() === 'Hectolitros') { total = row; break; }
    if (row[0]?.trim()) { code = row[0].trim(); material = row[1]?.trim() || ''; center = ''; }
    if (row[1]?.trim()) material = row[1].trim();
    if (row[2]?.trim()) center = row[2].trim();
    if (row[3]?.trim()) { row[0] = code; row[1] = material; row[2] = center; items.push(row); }
  }
  if (prepare) {
    ifCd.replaceChildren(new Option('Todos los centros', ''));
    [...new Set(items.map(row => row[2]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')).forEach(center => ifCd.add(new Option(center, center)));
  }
  const scroll = document.createElement('div'); scroll.className = 'summary-table-scroll';
  const table = document.createElement('table'); const head = table.createTHead().insertRow();
  header.slice(0, totalIndex + 1).forEach(value => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value.trim(); head.append(th); });
  const body = table.createTBody();
  for (const row of items.filter(row => !ifCd.value || row[2] === ifCd.value)) {
    const tr = body.insertRow();
    row.forEach((value, index) => { const cell = index === 0 ? document.createElement('th') : document.createElement('td'); if (index === 0) cell.scope = 'row'; cell.textContent = value.trim() || '–'; tr.append(cell); });
  }
  if (total && !ifCd.value) {
    const tr = body.insertRow(); tr.className = 'summary-total';
    total.forEach((value, index) => { const cell = index === 0 ? document.createElement('th') : document.createElement('td'); if (index === 0) cell.scope = 'row'; cell.textContent = index === 0 ? 'Total' : value.trim() || '–'; tr.append(cell); });
  }
  scroll.append(table); container.append(scroll);
}
ifCd.addEventListener('change', () => renderIf());
porId('ifClear').addEventListener('click', () => { ifCd.value = ''; renderIf(); });

function renderSku(prepare = false) {
  const container = porId('skuTable'); container.replaceChildren();
  const index = rows.findIndex(row => row[0]?.trim() === 'Código Material' && row[1]?.trim() === 'Material');
  if (index < 0) { container.textContent = 'No se encontró la tabla de TD SKUS en esta hoja.'; return; }
  const headers = rows[index];
  const totalIndex = headers.findIndex((value, col) => col > 1 && value.trim() === 'Hectolitros');
  if (totalIndex < 0) { container.textContent = 'No se encontró el total de la tabla de TD SKUS.'; return; }
  if (prepare) {
    skuCd.replaceChildren(new Option('Todos los centros', ''));
    headers.slice(2, totalIndex).forEach((name, index) => { if (name.trim()) skuCd.add(new Option(name.trim(), String(index + 2))); });
  }
  const selected = skuCd.value ? Number(skuCd.value) : null;
  const columns = selected === null ? Array.from({ length: totalIndex + 1 }, (_, index) => index) : [0, 1, selected];
  const scroll = document.createElement('div'); scroll.className = 'summary-table-scroll';
  const table = document.createElement('table'); const header = table.createTHead().insertRow();
  columns.forEach(col => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = headers[col].trim(); header.append(th); });
  const body = table.createTBody();
  for (const row of rows.slice(index + 1)) {
    if (!row.slice(0, totalIndex + 1).some(value => value.trim())) break;
    const total = row[0]?.trim() === 'Hectolitros';
    if (selected !== null && !total && !row[selected]?.trim()) continue;
    const tr = body.insertRow(); if (total) tr.className = 'summary-total';
    columns.forEach((col, i) => {
      const cell = i === 0 ? document.createElement('th') : document.createElement('td');
      if (i === 0) cell.scope = 'row'; cell.textContent = total && i === 0 ? 'Total' : row[col]?.trim() || '–'; tr.append(cell);
    });
    if (total) break;
  }
  scroll.append(table); container.append(scroll);
}
skuCd.addEventListener('change', () => renderSku());
porId('skuClear').addEventListener('click', () => { skuCd.value = ''; renderSku(); });

function renderSummary() {
  summaryTables.replaceChildren();
  const headerIndex = rows.findIndex(row => row[0]?.trim() === 'CD' && row[1]?.trim() === 'Hectolitros' && row[5]?.trim() === 'Código Material' && row[12]?.trim() === 'Mes 1');
  if (headerIndex < 0) {
    summaryTables.textContent = 'No se encontraron las tablas de riesgos en esta hoja.';
    return;
  }
  const dateRow = rows.slice(0, headerIndex).find(row => row[0]?.trim().toLocaleLowerCase('es') === 'fecha envio información');
  porId('summaryDate').textContent = dateRow?.[1] ? `Fecha de envío de información: ${dateRow[1]}` : 'Valores guardados en el archivo Excel';
  const definitions = [
    { title: 'Por centro de distribución', start: 0, width: 4 },
    { title: 'Por material', start: 5, width: 5 },
    { title: 'Por mes', start: 12, width: 4 },
  ];
  for (const definition of definitions) {
    const card = document.createElement('article'); card.className = 'summary-card';
    const heading = document.createElement('h4'); heading.textContent = definition.title; card.append(heading);
    const wrapper = document.createElement('div'); wrapper.className = 'summary-table-scroll';
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    rows[headerIndex].slice(definition.start, definition.start + definition.width).forEach(value => {
      const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = value.trim(); header.append(cell);
    });
    const body = table.createTBody();
    for (const row of rows.slice(headerIndex + 1)) {
      const cells = row.slice(definition.start, definition.start + definition.width);
      if (!cells.some(value => value.trim())) break;
      const total = cells[0]?.trim().toLocaleLowerCase('es') === 'hectolitros';
      const tr = body.insertRow(); if (total) tr.className = 'summary-total';
      cells.forEach((value, index) => {
        const cell = index === 0 ? document.createElement('th') : document.createElement('td');
        if (cell instanceof HTMLTableCellElement && index === 0) cell.scope = 'row';
        cell.textContent = total && index === 0 ? 'Total' : value.trim() || '–'; tr.append(cell);
      });
      if (total) break;
    }
    wrapper.append(table); card.append(wrapper); summaryTables.append(card);
  }
}

function prepareDailyFilters() {
  filterCd.replaceChildren(new Option('Todos los centros', ''));
  rowCenters = [];
  let currentCenter = '';
  let inData = false;
  const centers = new Set<string>();
  rows.forEach(row => {
    if (row[0]?.trim() === 'CD' && row[1]?.trim() === 'Código Material') { inData = true; currentCenter = ''; }
    else if (inData && row[0]?.trim()) {
      const value = row[0].trim();
      if (/^total\b/i.test(value) || /hectolitros/i.test(value)) currentCenter = '';
      else if (row[3]?.trim()) { currentCenter = value; centers.add(value); }
      else currentCenter = '';
    }
    rowCenters.push(inData && row[3]?.trim() ? currentCenter : '');
  });
  [...centers].sort((a, b) => a.localeCompare(b, 'es')).forEach(center => filterCd.add(new Option(center, center)));
}
filterCd.addEventListener('change', () => { if (sheetName === 'Diario SKU') renderDaily(); });
porId('clearFilters').addEventListener('click', () => { filterCd.value = ''; if (sheetName === 'Diario SKU') renderDaily(); });

function columnName(index: number): string {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
function showRow(row: string[], number: number) {
  porId('dialogSubtitle').textContent = `${sheetName} · Fila ${number}`;
  const data = porId('dialogData'); data.replaceChildren();
  row.forEach((value, index) => {
    if (!value) return;
    const dt = document.createElement('dt'); dt.textContent = `Columna ${columnName(startColumn + index)}`;
    const dd = document.createElement('dd'); dd.textContent = value;
    data.append(dt, dd);
  });
  if (!data.childElementCount) data.textContent = 'Esta fila no contiene valores.';
  dialog.showModal();
}
porId('closeDialog').addEventListener('click', () => dialog.close());

function menu(open: boolean) {
  porId('sidebar').classList.toggle('open', open);
  porId('overlay').hidden = !open;
}
porId('openMenu').addEventListener('click', () => menu(true));
porId('closeMenu').addEventListener('click', () => menu(false));
porId('overlay').addEventListener('click', () => menu(false));
document.addEventListener('keydown', event => { if (event.key === 'Escape') menu(false); });

function render() {
  table.replaceChildren();
  if (rows.length) {
    const head = table.createTHead(); const header = head.insertRow();
    const labels = ['#', ...rows[0].map((_, index) => `Columna ${columnName(startColumn + index)}`), 'Acciones'];
    labels.forEach(label => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; header.append(th); });
  }
  const fragment = document.createDocumentFragment();
  for (const { row, number } of filtered.slice(page * pageSize, (page + 1) * pageSize)) {
    const tr = document.createElement('tr');
    const rowNumber = document.createElement('th');
    rowNumber.scope = 'row'; const badge = document.createElement('span'); badge.className = 'row-badge'; badge.textContent = String(number); rowNumber.append(badge); tr.append(rowNumber);
    for (const value of row) { const td = document.createElement('td'); td.textContent = value || '–'; tr.append(td); }
    const actions = document.createElement('td'); actions.className = 'row-actions';
    const view = document.createElement('button'); view.type = 'button'; view.className = 'view-row'; view.textContent = '◉  Ver'; view.setAttribute('aria-label', `Ver detalle de la fila ${number}`); view.addEventListener('click', () => showRow(row, number)); actions.append(view); tr.append(actions);
    fragment.append(tr);
  }
  const body = document.createElement('tbody'); body.append(fragment); table.append(body);
  empty.hidden = filtered.length !== 0;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const first = filtered.length ? page * pageSize + 1 : 0;
  const last = Math.min((page + 1) * pageSize, filtered.length);
  porId('pageInfo').textContent = `Mostrando ${first.toLocaleString('es-CO')} a ${last.toLocaleString('es-CO')} de ${filtered.length.toLocaleString('es-CO')} registros`;
  porId('pageNumber').textContent = String(page + 1);
  porId('rowCount').textContent = `${filtered.length.toLocaleString('es-CO')} filas${search.value || (sheetName === 'Diario SKU' && filterCd.value) ? ' encontradas' : ' en esta hoja'}`;
  previous.disabled = page === 0; next.disabled = page + 1 >= totalPages;
}
function filterRows() {
  const query = search.value.trim().toLocaleLowerCase('es');
  filtered = rows.map((row, index) => ({ row, number: index + startRow })).filter((item, index) => {
    const matchesCenter = sheetName !== 'Diario SKU' || !filterCd.value || rowCenters[index] === filterCd.value;
    return matchesCenter && (!query || item.row.some(cell => cell.toLocaleLowerCase('es').includes(query)));
  });
  page = 0; render();
}
async function selectSheet(sheet: Sheet) {
  const id = ++requestId; search.value = ''; startRow = sheet.startRow; sheetName = sheet.name; startColumn = sheet.startColumn ?? 0;
  diarioFilters.hidden = sheet.name !== 'Diario SKU'; dailyView.hidden = sheet.name !== 'Diario SKU';
  summaryView.hidden = sheet.name !== 'Resumen'; skuView.hidden = sheet.name !== 'TD SKUS'; ifView.hidden = sheet.name !== 'IF 30 a 60 días'; riskView.hidden = sheet.name !== 'Riesgos CD'; trendView.hidden = sheet.name !== 'Tendencia diaria'; kaView.hidden = sheet.name !== 'KA'; rangeView.hidden = sheet.name !== 'Riesgos rango días'; porId('sheetData').hidden = ['Diario SKU', 'Resumen', 'TD SKUS', 'IF 30 a 60 días', 'Riesgos CD', 'Tendencia diaria', 'KA', 'Riesgos rango días'].includes(sheet.name);
  empty.textContent = 'No se encontraron resultados.';
  porId('breadcrumb').textContent = sheet.name;
  document.querySelectorAll<HTMLButtonElement>('[data-sheet]').forEach(button => {
    const selected = Number(button.dataset.sheet) === sheet.id;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  menu(false); table.replaceChildren(); empty.hidden = true;
  if (mostrarConsolidado(sheet.name)) return;
  porId('rowCount').textContent = 'Cargando información…';
  const finalizarCarga = iniciarCarga();
  try {
    const response = await fetch(`/api/frescura/${sheet.id}.json`);
    if (!response.ok) throw new Error('No se pudo cargar la hoja.');
    const result: string[][] = await response.json();
    if (id !== requestId) return;
    rows = result; if (sheet.name === 'Diario SKU') { prepareDailyFilters(); renderDaily(); } if (sheet.name === 'Resumen') renderSummary(); if (sheet.name === 'TD SKUS') renderSku(true); if (sheet.name === 'IF 30 a 60 días') renderIf(true); if (sheet.name === 'Riesgos CD') renderRisk(true); if (sheet.name === 'Tendencia diaria') renderTrend(true); if (sheet.name === 'KA') renderKa(true); if (sheet.name === 'Riesgos rango días') renderRange(); filterRows();
  } catch {
    if (id !== requestId) return;
    rows = []; filtered = []; render();
    empty.textContent = 'No se pudo cargar la información de esta hoja.'; empty.hidden = false;
    if (sheet.name === 'Resumen') summaryTables.textContent = 'No se pudo cargar la información de Resumen.';
    if (sheet.name === 'TD SKUS') porId('skuTable').textContent = 'No se pudo cargar la información de TD SKUS.';
    if (sheet.name === 'IF 30 a 60 días') porId('ifTable').textContent = 'No se pudo cargar la información de esta hoja.';
    if (sheet.name === 'Riesgos CD') porId('riskTable').textContent = 'No se pudo cargar la información de esta hoja.';
    if (sheet.name === 'Tendencia diaria') porId('trendTable').textContent = 'No se pudo cargar la información de esta hoja.';
    if (sheet.name === 'KA') porId('kaTable').textContent = 'No se pudo cargar la información de esta hoja.';
    if (sheet.name === 'Riesgos rango días') porId('rangeTables').textContent = 'No se pudo cargar la información de esta hoja.';
    if (sheet.name === 'Diario SKU') porId('dailyTable').textContent = 'No se pudo cargar la información de esta hoja.';
  } finally { finalizarCarga(); }
}
search.addEventListener('input', filterRows);
previous.addEventListener('click', () => { if (page > 0) { page--; render(); } });
next.addEventListener('click', () => { if ((page + 1) * pageSize < filtered.length) { page++; render(); } });
porId('logout').addEventListener('click', async () => { const finalizarCarga = iniciarCarga(); try { await fetch('/api/logout', { method: 'POST' }); location.href = '/'; } finally { finalizarCarga(); } });

async function start() {
  const finalizarCarga = iniciarCarga();
  try {
    const [userResponse, indexResponse] = await Promise.all([fetch('/api/me'), fetch('/api/frescura/indice.json')]);
    if (userResponse.status === 401) { location.href = '/'; return; }
    if (!userResponse.ok) throw new Error('No se pudo cargar la información del usuario.');
    const user: { nombre: string } = await userResponse.json();
    porId('userName').textContent = user.nombre;
    if (!indexResponse.ok) {
      const error: { error?: string } = await indexResponse.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo cargar el informe.');
    }
    const index: Index = await indexResponse.json();
    modules.replaceChildren();
    const hiddenSheets = new Set(['Hoja1', 'Gerencias', 'Traslados', 'Riesgos Gerencia', 'Septiembre', 'Octubre', 'Caucasia', 'BBC', 'IF 30 a 60 días LM', 'Reporte']);
    const orderedSheets = index.sheets.filter(sheet => !hiddenSheets.has(sheet.name));
    const skuIndex = orderedSheets.findIndex(sheet => sheet.name === 'TD SKUS');
    if (skuIndex >= 0) {
      const [sku] = orderedSheets.splice(skuIndex, 1);
      const summaryIndex = orderedSheets.findIndex(sheet => sheet.name === 'Resumen');
      orderedSheets.splice(summaryIndex < 0 ? 0 : summaryIndex + 1, 0, sku);
    }
    const ifIndex = orderedSheets.findIndex(sheet => sheet.name === 'IF 30 a 60 días');
    if (ifIndex >= 0) {
      const [ifSheet] = orderedSheets.splice(ifIndex, 1);
      const skuPosition = orderedSheets.findIndex(sheet => sheet.name === 'TD SKUS');
      orderedSheets.splice(skuPosition < 0 ? 0 : skuPosition + 1, 0, ifSheet);
    }
    const riskIndex = orderedSheets.findIndex(sheet => sheet.name === 'Riesgos CD');
    if (riskIndex >= 0) {
      const [riskSheet] = orderedSheets.splice(riskIndex, 1);
      const ifPosition = orderedSheets.findIndex(sheet => sheet.name === 'IF 30 a 60 días');
      orderedSheets.splice(ifPosition < 0 ? 0 : ifPosition + 1, 0, riskSheet);
    }
    const trendIndex = orderedSheets.findIndex(sheet => sheet.name === 'Tendencia diaria');
    if (trendIndex >= 0) {
      const [trendSheet] = orderedSheets.splice(trendIndex, 1);
      const riskPosition = orderedSheets.findIndex(sheet => sheet.name === 'Riesgos CD');
      orderedSheets.splice(riskPosition < 0 ? 0 : riskPosition + 1, 0, trendSheet);
    }
    const kaIndex = orderedSheets.findIndex(sheet => sheet.name === 'KA');
    if (kaIndex >= 0) {
      const [kaSheet] = orderedSheets.splice(kaIndex, 1);
      const trendPosition = orderedSheets.findIndex(sheet => sheet.name === 'Tendencia diaria');
      orderedSheets.splice(trendPosition < 0 ? 0 : trendPosition + 1, 0, kaSheet);
    }
    const rangeIndex = orderedSheets.findIndex(sheet => sheet.name === 'Riesgos rango días');
    if (rangeIndex >= 0) {
      const [rangeSheet] = orderedSheets.splice(rangeIndex, 1);
      const kaPosition = orderedSheets.findIndex(sheet => sheet.name === 'KA');
      orderedSheets.splice(kaPosition < 0 ? 0 : kaPosition + 1, 0, rangeSheet);
    }
    orderedSheets.forEach(sheet => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'module'; button.dataset.sheet = String(sheet.id);
      const icon = document.createElement('span'); icon.className = 'module-icon';
      const icons: Record<string, string> = {
        'Diario SKU': 'M4 4v16M7 4v16M10 4v16M14 4v16M17 4v16M20 4v16',
        'Resumen': 'M12 3v9h9M20.5 14A8.5 8.5 0 1 1 10 3.5V14zM14 3.5A8.5 8.5 0 0 1 20.5 10H14z',
        'TD SKUS': 'M12 3 3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
        'IF 30 a 60 días': 'M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2zM7 3v4M17 3v4M3 10h18M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2M15 17h2',
        'Riesgos CD': 'M12 3 2.5 20h19L12 3zM12 9v5M12 17h.01',
        'Tendencia diaria': 'M3 18l6-6 4 4 8-9M16 7h5v5',
        'KA': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-2a8 8 0 0 1 16 0v2',
        'Riesgos rango días': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
      };
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const trazo = document.createElementNS('http://www.w3.org/2000/svg', 'path'); trazo.setAttribute('d', icons[sheet.name] ?? 'M4 4h16v16H4z'); trazo.setAttribute('fill', 'none'); trazo.setAttribute('stroke', 'currentColor'); trazo.setAttribute('stroke-width', '1.8'); trazo.setAttribute('stroke-linecap', 'round'); trazo.setAttribute('stroke-linejoin', 'round'); svg.append(trazo); icon.append(svg);
      const label = document.createElement('span'); label.textContent = sheet.name; button.append(icon, label);
      button.addEventListener('click', () => selectSheet(sheet)); modules.append(button);
      if (sheet.name === 'Diario SKU' || sheet.name === 'Resumen') {
        const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'quick-tab'; tab.dataset.sheet = String(sheet.id); tab.textContent = `${sheet.name === 'Resumen' ? '◕' : '▥'}  ${sheet.name}`;
        tab.addEventListener('click', () => selectSheet(sheet)); porId('quickTabs').append(tab);
      }
    });
    const initial = index.sheets.find(sheet => sheet.name === 'Diario SKU') ?? index.sheets[0];
    if (initial) await selectSheet(initial);
  } catch (error) {
    modules.textContent = error instanceof Error ? error.message : 'No se pudo cargar el informe.';
    porId('rowCount').textContent = 'No se pudo obtener el catálogo de hojas. Vuelve a intentarlo.';
  } finally { finalizarCarga(); }
}
prepararConsolidado();
const scrollReporte = document.querySelector<HTMLElement>('#sheetData .table-scroll');
if (scrollReporte) scrollReporte.insertAdjacentElement('afterend', navegacionColumnas(scrollReporte));
start();
